import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

import express from 'express'
import cron from "node-cron"
import { ScreepsAPI } from 'screeps-api';
import fs from 'fs'
const users = JSON.parse(fs.readFileSync('./users.json'));

const app = express()
const port = 10002

import { WebhookClient } from 'discord.js';
const usingDiscordWebhook = process.env.DISCORD_WEBHOOK_URL !== undefined && process.env.DISCORD_WEBHOOK_URL !== ''
let webhookClient = null
if (usingDiscordWebhook) {
  webhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL });
}

import winston from "winston"
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.json(),
    winston.format.timestamp(),
    winston.format.prettyPrint(),
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

function writeErrorsByCount(errors) {
  const errorByCount = []
  for (let error of errors) {
    error = error.replaceAll("&#39;","")
    const index = errorByCount.findIndex(e => e.stack === error)
    if (index === -1) errorByCount.push({ stack: error, count: 1 })
    else errorByCount[index].count++
  }

  const oldErrors = fs.existsSync("./errors.json") ? JSON.parse(fs.readFileSync('./errors.json')) : []
  for (let i = 0; i < errorByCount.length; i++) {
    const error = errorByCount[i];
    const oldIndex = oldErrors.findIndex(e => e.stack === error.stack)
    const index = errorByCount.findIndex(e => e.stack === error.stack)

    if (oldIndex === -1) oldErrors.push({ stack: error.stack, count: errorByCount[index].count })
    else oldErrors[oldIndex].count += errorByCount[index].count
  }

  oldErrors.sort((a, b) => b.count - a.count)
  errorByCount.sort((a, b) => b.count - a.count)

  fs.writeFileSync('./errors.json', JSON.stringify(oldErrors))
  return errorByCount
}

async function handle() {
  console.log()
  console.log('/------------------------')
  console.log(new Date())

  const errors = []
  for (const user of users) {
    const api = new ScreepsAPI(user)
    const getResult = await api.segment.get(user.segment, user.shard)
    if (!getResult.ok || getResult.ok !== 1 || getResult.data === null) {
      logger.error(`Error getting segment for ${user.name} - ${JSON.stringify(getResult)}`)
      continue;
    };

    const data = JSON.parse(getResult.data)
    if (data.errors.length === 0) {
      logger.info(`No errors for ${user.name}`)
      continue;
    };

    const setResult = await api.segment.set(user.segment, JSON.stringify({ errors: [] }), user.shard)
    if (!setResult.ok || setResult.ok !== 1) {
      logger.error(`Error setting segment for ${user.name} - ${JSON.stringify(setResult)}`)
      continue;
    };

    errors.push(...data.errors)
    logger.info(`Added ${data.errors.length} errors from ${user.name} to error array`)
  }

  const errorByCount = writeErrorsByCount(errors)
  if (usingDiscordWebhook) {
    const webhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL });
    const text = errorByCount.map(e => `${e.count}x ${e.stack}\r\n\r\n`).join('')
    if (text) webhookClient.send({
      content: text,
      username: 'The-International - Error Exporter',
      avatarURL: 'https://avatars.githubusercontent.com/u/107775846?s=200&v=4',
    });
  }
  logger.info(`Total amount of unique errors: ${errorByCount.length}`)
}

cron.schedule('0 * * * *', () => handle());

app.get('/', (req, res) => {
  const errors = fs.readFileSync('./errors.json')
  res.send({ result: true, errors: JSON.parse(errors) })
})

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
  handle()
})