import { syncFromRemote } from './src/backup/backup.ts'
const result = await syncFromRemote(undefined, true)
console.log(JSON.stringify(result, null, 2))
