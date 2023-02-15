# ErrorExporter

An email error exporter replacement

## Requirements

- Node 16.9 or higher
- Docker (optional)

## Installation

1. Clone the repository
2. Run `npm install` to install dependencies

## Configuration

### Bot

- Copy screepsCode/ErrorExporter(.js or .ts) to your bot folder and use it the following way: import or require the file, default and static class is exported which you should use to export errors with by executing `ErrorExporter.addErrorToSegment(errorMessage)`.
- You can include an optional version number after the errorMessage param.

### Server

- Copy users.json.example to users.json and fill in your information. Name, shard, segment and authentication form are mandatory (token, or username+password (don't include token)). Authentication form can be just token for mmo or email and password for private servers.
- Copy .env.example to .env and fill in your [discord webhook url](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) if you do want this enabled.
- Run `npm run start` or `npm run start:docker` to start in docker.

## Usage

- After installation, the tool will start to retrieve errors and save them by count every hour. You can change this by editing the `CRON_TAB_SYNTAX` variable in the .env file using the [syntax generator](https://crontab-generator.org/).
- About 200 errors can be saved in a segment per shard. If you are above 90% of the segment, it stops exporting and alerts your email via Game.notify in Screeps.
- By default, port 10003 is used for the API. You can change this at the top of the `errorsGetter/index` file. The URL is [http://localhost:10003](http://localhost:10003).
