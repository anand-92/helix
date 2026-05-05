import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  project: ['src/**/*.{ts,tsx}'],
  ignore: ['src/components/ui/**'],
  ignoreDependencies: [
    'shadcn',
    '@types/react-router-dom',
  ],
}

export default config
