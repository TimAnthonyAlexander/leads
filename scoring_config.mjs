// scoring_config.mjs - Weighted scoring for dev-tool SaaS targeting

export const WEIGHTS = {
  // Strong dev/team signals (positive)
  'api': 3,
  'rest api': 3,
  'graphql': 2,
  'sdk': 3,
  'webhook': 2,
  'webhooks': 2,
  'cli': 2,
  'command line': 2,
  'github app': 2,
  'integration': 1,
  'integrations': 1,
  'status page': 1,
  'changelog': 1,
  'developer': 2,
  'developers': 2,
  'devops': 2,
  'infrastructure': 1,
  'deployment': 1,
  'ci/cd': 2,
  'automation': 1,
  
  // Team/collaboration cues (positive)
  'per seat': 2,
  'per user': 2,
  'workspace': 2,
  'workspaces': 2,
  'team': 2,
  'teams': 2,
  'team plan': 2,
  'saml': 3,
  'sso': 3,
  'single sign-on': 3,
  'audit log': 2,
  'audit logs': 2,
  'rbac': 2,
  'role-based': 2,
  'enterprise': 1,
  'enterprise plan': 2,
  'organization': 1,
  'organizations': 1,
  'collaboration': 1,
  'collaborate': 1,
  
  // SaaS fundamentals (positive)
  'pricing': 1,
  'signup': 1,
  'sign up': 1,
  'get started': 1,
  'demo': 1,
  'request demo': 1,
  'trial': 1,
  'free trial': 1,
  'docs': 2,
  'documentation': 2,
  'api reference': 3,
  'getting started': 1,
  
  // Maturity signals (positive)
  'careers': 1,
  'hiring': 1,
  'we are hiring': 1,
  'we\'re hiring': 1,
  'join us': 1,
  'join our team': 1,
  'security policy': 1,
  'security': 1,
  'soc 2': 2,
  'soc2': 2,
  'gdpr': 1,
  'compliance': 1,
  'about us': 0.5,
  'our team': 0.5,
  'roadmap': 1,
  'status': 1,
  
  // Freshness/launch (boost)
  'show hn': 2,
  'product hunt': 2,
  'launching today': 2,
  'just launched': 2,
  'beta': 1,
  'early access': 1,
  'coming soon': 1,
  'now available': 1,
  'announcing': 1,
  
  // Negative signals
  'blog': -1,
  'wordpress': -2,
  'powered by wordpress': -2,
  'powered by': -1,
  'tutorial': -1,
  'course': -1,
  'learn': -0.5,
  'buy now': -2,
  'ecommerce': -2,
  'shop': -2,
  'store': -1,
  'portfolio': -1,
  'resume': -2,
  'personal website': -2,
  'game': -2,
  'download': -1
};

// Dev signals that count for the requirement
export const DEV_SIGNALS = [
  'api', 'rest api', 'graphql', 'sdk', 'webhook', 'webhooks', 
  'cli', 'command line', 'github app', 'docs', 'documentation',
  'api reference', 'developer', 'developers', 'devops'
];

// Team signals that count for the requirement
export const TEAM_SIGNALS = [
  'workspace', 'workspaces', 'team', 'teams', 'per seat', 'per user',
  'saml', 'sso', 'single sign-on', 'audit log', 'audit logs', 
  'rbac', 'role-based', 'enterprise plan', 'team plan', 'organization', 'organizations'
];

// Pricing model patterns
export const PRICING_MODELS = {
  'per_seat': ['per seat', 'per user', '/user', '/seat'],
  'per_workspace': ['per workspace', 'per organization', 'per team'],
  'usage_based': ['usage-based', 'pay as you go', 'per request', 'per api call'],
  'flat_rate': ['flat rate', 'unlimited', 'fixed price'],
  'freemium': ['free plan', 'free tier', 'free forever'],
  'open_source': ['open source', 'open-source', 'self-hosted', 'self hosted'],
  'enterprise': ['enterprise pricing', 'custom pricing', 'contact sales']
};

export const THRESHOLDS = {
  minimum_score: 5,        // Below this, drop
  require_team_cue: true,  // Must have at least one team signal
  require_dev_signal: true // Must have at least one dev signal
};

// Builder platforms to heavily downrank
export const BUILDER_DOMAINS = new Set([
  'wix.com', 'webflow.io', 'squarespace.com', 'carrd.co',
  'wordpress.com', 'weebly.com', 'jimdo.com', 'site123.com'
]);

// Expanded skip domains
export const SKIP_DOMAINS = new Set([
  'github.com', 'substack.com', 'steampowered.com', 'medium.com',
  'wordpress.com', 'blogspot.com', 'tumblr.com', 'wixsite.com',
  'marketplace.visualstudio.com', 'chrome.google.com', 'addons.mozilla.org',
  'play.google.com', 'apps.apple.com', 'reddit.com', 'twitter.com',
  'linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com'
]);

// Multi-tenant platforms
export const MULTI_TENANT_SUFFIXES = [
  'vercel.app', 'netlify.app', 'github.io', 'herokuapp.com',
  'azurewebsites.net', 'cloudfront.net', 'amplifyapp.com',
  'web.app', 'firebaseapp.com', 'pages.dev', 'repl.co',
  'glitch.me', 'now.sh', 'railway.app'
];

