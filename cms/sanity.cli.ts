import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: 'slg2cgjj',
    dataset: 'production'
  },
  deployment: {
    appId: 'evk8lfw0hvatacx4bvv0q857',
    autoUpdates: true,
  }
})
