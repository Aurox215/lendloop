import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
crons.interval('Recover interrupted notification deliveries', { minutes: 5 }, internal.automation.retry, {})
crons.interval('Recover missing overdue alarms', { minutes: 5 }, internal.overdue.recover, {})
export default crons
