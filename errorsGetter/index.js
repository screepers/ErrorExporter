import * as dotenv from 'dotenv'
import LokiTransport from "winston-loki";
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
const isWindows = process.platform === 'win32'

const app = express()
const port = 10002
const usingDiscordWebhook = process.env.DISCORD_WEBHOOK_URL !== undefined && process.env.DISCORD_WEBHOOK_URL !== ''
const usingLoki = process.env.GRAFANA_LOKI_URL !== undefined && process.env.GRAFANA_LOKI_URL !== ''
const usingGraphite = process.env.GRAFANA_GRAPHITE_URL !== undefined && process.env.GRAFANA_GRAPHITE_URL !== ''

let lastMessage

import winston from 'winston'
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.json(), winston.format.timestamp(), winston.format.prettyPrint()),
  transports: [
    new winston.transports.File({ filename: 'logs/errors.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
})

let lokiLogger = usingLoki ? winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.json(), winston.format.timestamp(), winston.format.prettyPrint()),
  transports: [
    new LokiTransport({
      host: process.env.GRAFANA_LOKI_URL.replace(process.env.ENVIRONMENT ? "localhost" : "none", isWindows ? "host.docker.internal" : "172.17.0.1"),
      labels: { app: 'ErrorExporter' },
      json: true,
      batching: false,
      format: winston.format.json(),
      replaceTimestamp: true,
      interval: 1,
      onConnectionError: (err) => logger.error(err)
    })
  ],
}) : null
const client = usingGraphite ? graphite.createClient(`plaintext://${process.env.GRAFANA_GRAPHITE_URL.replace(process.env.ENVIRONMENT ? "localhost" : "none", isWindows ? "host.docker.internal" : "172.17.0.1").replace("https://", "").replace("http://", "")}/`) : null

const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

if (!fs.existsSync('./logs')) fs.mkdirSync('./logs')
async function writeErrorsByCount(userErrors) {
  let lokiErrors = 0;
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

      const testName = error.replace(/(\r\n|\n|\r)/gm, "").replace(/\s/g, '_').replace(/\\|\//g, ':').replace(/\(|\)|\./g, '').replace(/Error:/g,"").split("__")[0];

      if (errorsByUser[user] === undefined) errorsByUser[user] = {}
      if (errorsByUser[user][testName] === undefined) errorsByUser[user][testName] = { count: 1 }
      else errorsByUser[user][testName].count += 1

      if (usingLoki) {
        try {
          lokiLogger.info({ message: `stack=${error}`, labels: { user, version } })
          await sleep(1000)
          lokiErrors += 1
        } catch (error) {
          logger.error(error)
        }
      }
    }
  }

  if (usingGraphite) {
    //    for (const user in errorsByUser) {
    //      const userErrors = errorsByUser[user]
    //      for (const error in userErrors) {
    //        const errorCount = userErrors[error].count
    //        client.write({ errors: { [user]: { [error]: errorCount} } }, (err) => {
    //          if (err) logger.error(err)
    //        })
    //      }
    //    }
    logger.info("Writing to graphite")
    client.write({ errors: errorsByUser }, (err) => {
      if (err) logger.error(err)
    })
  }

  const oldErrors = fs.existsSync('./logs/errors.json') ? JSON.parse(fs.readFileSync('./logs/errors.json')) : []
  for (let i = 0; i < errorByCount.length; i++) {
    const error = errorByCount[i]
    const oldIndex = oldErrors.findIndex(e => e.stack === error.stack)
    const index = errorByCount.findIndex(e => e.stack === error.stack)

    if (oldIndex === -1)
      oldErrors.push({
        stack: error.stack,
        count: errorByCount[index].count,
        lastSeen: errorByCount[index].lastSeen,
      })
    else {
      oldErrors[oldIndex].count += errorByCount[index].count
      oldErrors[oldIndex].lastSeen = errorByCount[index].lastSeen
    }
  }

  oldErrors.sort((a, b) => b.count - a.count)
  errorByCount.sort((a, b) => b.count - a.count)

  try {
    const jsonText = JSON.stringify(oldErrors)
    JSON.parse(jsonText)
    fs.writeFileSync('./logs/errors.json', jsonText)
  } catch (error) {
    logger.error(`OldErrors: ${oldErrors}, Error: ${error}`)
  }
  finally {
    logger.info(`Total errors saved: ${errorByCount.length}`)
    return errorByCount
  }
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

    const getResult = await api.segment.get(user.segment, user.shard)
    if (!getResult.ok || getResult.ok !== 1 || getResult.data === null || getResult.data === "") {
      logger.error(`Error getting segment for ${user.username} - ${JSON.stringify(getResult)}`)
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
  logger.info(`Total amount of unique errors: ${errorByCount.length}`)
}

cron.schedule(process.env.CRON_JOB_SYNTAX || '*/30 * * * *', () => handle())

app.get('/', (req, res) => {
  const errors = fs.readFileSync('./logs/errors.json')
  res.send({ result: true, errors: JSON.parse(errors) })
})
app.get('/errors', (req, res) => {
  const errors = fs.readFileSync('./logs/errors.json')
  res.json(JSON.parse(errors))
})

app.get('/logs/:name', function (req, res, next) {
  const options = {
    root: join(__dirname, '../logs'),
    dotfiles: 'deny',
    headers: {
      'x-timestamp': Date.now(),
      'x-sent': true,
    },
  }

  const fileName = req.params.name
  res.sendFile(fileName, options, function (err) {
    if (err) {
      next(err)
    } else {
      console.log('Sent:', fileName)
    }
  })
})

app.set('json spaces', 2)
app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
  handle()
})
