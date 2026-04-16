import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@dotenvy/shared', '@dotenvy/db'],
}

export default config
