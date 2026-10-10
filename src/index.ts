#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

// stdio transport: the AI app launches this process and talks to it over
// stdin/stdout, so nothing here may write to stdout except the protocol.
await createServer().connect(new StdioServerTransport())
