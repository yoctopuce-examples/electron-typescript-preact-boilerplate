import { app } from 'electron'
import { startApplication } from './Main/main.js'

app.whenReady().then(startApplication);
