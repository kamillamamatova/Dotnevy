import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@pullenv/shared', '@pullenv/db'],
}

export default config
