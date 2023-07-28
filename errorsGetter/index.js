import * as dotenv from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cron from 'node-cron'
import { ScreepsAPI } from 'screeps-api'
import fs from 'fs'
import graphite from 'graphite'
import { WebhookClient } from 'discord.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const users = JSON.parse(fs.readFileSync('./users.json'))

const app = express()
const port = 10002
const usingDiscordWebhook = process.env.DISCORD_WEBHOOK_URL !== undefined && process.env.DISCORD_WEBHOOK_URL !== ''

let lastMessage
let lastPull = 0;

import winston from 'winston'
import 'winston-daily-rotate-file';

const transport = new winston.transports.DailyRotateFile({
  filename: 'logs/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.json(), winston.format.timestamp(), winston.format.prettyPrint()),
  transports: [
    transport
  ],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

const client = graphite.createClient(`plaintext://${process.env.GRAFANA_GRAPHITE_URL}/`)

async function writeErrorsByCount(userErrors) {
  const errorByCount = []
  const errorsByUser = {}
  for (const user in userErrors) {
    const { version } = userErrors[user]
    for (let error of userErrors[user].errors) {
      const lastSeen = {
        date: new Date().toUTCString(),
        user,
        version,
      }

      error = error.replaceAll('&#39;', '')
      const index = errorByCount.findIndex(e => e.stack === error)
      if (index === -1) errorByCount.push({ stack: error, count: 1, lastSeen })
      else {
        errorByCount[index].count++
        errorByCount[index].lastSeen = lastSeen
      }

      const testName = error.replace(/(\r\n|\n|\r)/gm, "").replace(/\s/g, '_').replace(/\\|\//g, ':').replace(/\(|\)|\./g, '').replace(/Error:/g, "").split("__")[0];

      if (errorsByUser[user] === undefined) errorsByUser[user] = {}
      if (errorsByUser[user][testName] === undefined) errorsByUser[user][testName] = { count: 1 }
      else errorsByUser[user][testName].count += 1
    }
  }

  logger.info("Writing to graphite")
  client.write({ errors: errorsByUser }, (err) => {
    if (err) logger.error(err)
  })

  errorByCount.sort((a, b) => b.count - a.count)

  logger.info(`Total errors saved: ${errorByCount.length}`)
  return errorByCount
}

const getTimestamp = date => Math.floor(date.getTime() / 1000)
function generateText(errorByCount) {
  if (errorByCount.length === 0) {
    const isNoErrorMessage = !lastMessage || !lastMessage.content.startsWith('No errors found')
    if (isNoErrorMessage) return 'No errors found'
    return `No errors found since <t:${getTimestamp(
      new Date(lastMessage.timestamp),
    )}:R>, last checked <t:${getTimestamp(new Date())}:R>`
  }
  return errorByCount
    .map(e => {
      const lastSeen = `Last seen <t:${getTimestamp(new Date(e.lastSeen.date))}:R>, by ${e.lastSeen.user}${e.lastSeen.version ? `, with version ${e.lastSeen.version}` : ''
        }\r\n`
      const count = `Count: ${e.count}x\r\n`
      const stack = `\`\`\`json\r\n${e.stack}\`\`\``
      return `${lastSeen + count + stack}\r\n\r\n\r\n`
    })
    .join('')
}

async function handle() {
  console.log()
  console.log('/------------------------')
  console.log(new Date())

  const errors = {}
  for (const user of users) {
    let api = new ScreepsAPI()
    if (user.token) {
      api = new ScreepsAPI(user)
    } else {
      const url = user.url || "localhost";
      const protocol = url.startsWith("https") ? "https" : "http";
      const hostname = url.replace("https://", "").replace("http://", "").split(":")[0];
      const port = Number(url.includes(":") ? url.includes("://") ? url.split(":")[2] : url.split(":")[1] : 21025);
      await api.auth(user.username, user.password, {
        protocol,
        hostname,
        port,
      })
    }

    let getResult = null
    try {
      getResult = await api.segment.get(user.segment, user.shard)
      if (!getResult.ok || getResult.ok !== 1 || getResult.data === null || getResult.data === "") {
        logger.error(`Error getting segment for ${user.username} - ${JSON.stringify(getResult)}`)
        continue
      }
    } catch (error) {
      logger.error(`Error getting segment for ${user.username} with ${user.token} or password ${user.password}, error: ${error}`)
      continue
    }


    const data = JSON.parse(getResult.data)
    if (data.errors.length === 0) {
      logger.info(`No errors for ${user.username}`)
      continue
    }

    const setResult = await api.segment.set(user.segment, JSON.stringify({ errors: [] }), user.shard)
    if (!setResult.ok || setResult.ok !== 1) {
      logger.error(`Error setting segment for ${user.username} - ${JSON.stringify(setResult)}`)
      continue
    }

    if (!errors[user.username]) errors[user.username] = { errors: [], version: data.version }
    errors[user.username].errors.push(...data.errors)
    logger.info(`Added ${data.errors.length} errors from ${user.username} to error array`)
  }

  const errorByCount = await writeErrorsByCount(errors)
  if (usingDiscordWebhook) {
    const webhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL })
    const noNewErrors = lastMessage && lastMessage.content.startsWith('No errors found')
    let text = generateText(errorByCount)
    if (text.length > 1950) text = `${text.substring(0, 1950)}.....`
    if (!noNewErrors)
      lastMessage = await webhookClient.send({
        content: text,
        username: 'The-International - Error Exporter',
        avatarURL: 'https://avatars.githubusercontent.com/u/107775846?s=200&v=4',
      })
    else {
      lastMessage = await webhookClient.editMessage(lastMessage, { content: text })
    }
  }
  lastPull = Date.now()
  logger.info(`Total amount of unique errors: ${errorByCount.length}`)
}

cron.schedule(process.env.CRON_JOB_SYNTAX || '*/30 * * * *', () => handle())

app.get('/', (req, res) => {
  const isOnline = Date.now() - lastPull < 1000 * 60 * 60 * 24
  res.send({ result: isOnline })
})

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
  handle()
})
