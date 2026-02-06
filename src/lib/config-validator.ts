/**
 * Configuration Validator
 *
 * Validates environment configuration at startup to fail fast
 * instead of discovering errors at runtime.
 */

interface ValidationError {
  field: string;
  message: string;
  fix: string;
}

/**
 * Validates the application configuration
 * Throws an error with detailed messages if configuration is invalid
 */
export async function validateConfig(): Promise<void> {
  const errors: ValidationError[] = [];

  const authProvider = process.env.KPH_AUTH_PROVIDER ?? 'none';
  const llmProvider = process.env.KPH_LLM_PROVIDER;
  const emailProvider = process.env.KPH_EMAIL_PROVIDER;

  // Validate Auth Provider Configuration
  if (authProvider === 'clerk') {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      errors.push({
        field: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
        message: 'Clerk publishable key is required when using Clerk authentication',
        fix: 'Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable',
      });
    }
    if (!process.env.CLERK_SECRET_KEY) {
      errors.push({
        field: 'CLERK_SECRET_KEY',
        message: 'Clerk secret key is required when using Clerk authentication',
        fix: 'Set CLERK_SECRET_KEY environment variable',
      });
    }
  } else if (authProvider === 'oidc') {
    if (!process.env.KPH_OIDC_ISSUER_URL) {
      errors.push({
        field: 'KPH_OIDC_ISSUER_URL',
        message: 'OIDC issuer URL is required when using OIDC authentication',
        fix: 'Set KPH_OIDC_ISSUER_URL environment variable',
      });
    }
    if (!process.env.KPH_OIDC_CLIENT_ID) {
      errors.push({
        field: 'KPH_OIDC_CLIENT_ID',
        message: 'OIDC client ID is required when using OIDC authentication',
        fix: 'Set KPH_OIDC_CLIENT_ID environment variable',
      });
    }
    if (!process.env.KPH_OIDC_CLIENT_SECRET) {
      errors.push({
        field: 'KPH_OIDC_CLIENT_SECRET',
        message: 'OIDC client secret is required when using OIDC authentication',
        fix: 'Set KPH_OIDC_CLIENT_SECRET environment variable',
      });
    }
  }

  // Validate LLM Provider Configuration
  if (llmProvider) {
    const llmApiKey = process.env.KPH_LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY;

    if (llmProvider === 'anthropic' && !llmApiKey) {
      errors.push({
        field: 'KPH_LLM_API_KEY',
        message: 'API key is required for Anthropic LLM provider',
        fix: 'Set KPH_LLM_API_KEY or ANTHROPIC_API_KEY environment variable',
      });
    } else if (llmProvider === 'openai' && !llmApiKey) {
      errors.push({
        field: 'KPH_LLM_API_KEY',
        message: 'API key is required for OpenAI LLM provider',
        fix: 'Set KPH_LLM_API_KEY environment variable',
      });
    } else if (llmProvider === 'openai-compatible' && !process.env.KPH_LLM_ENDPOINT) {
      errors.push({
        field: 'KPH_LLM_ENDPOINT',
        message: 'Endpoint URL is required for OpenAI-compatible LLM provider',
        fix: 'Set KPH_LLM_ENDPOINT environment variable (e.g., http://localhost:8080/v1)',
      });
    }
    // Note: Ollama doesn't require an API key and defaults to localhost:11434
  }

  // Validate Email Provider Configuration
  if (emailProvider === 'resend') {
    if (!process.env.RESEND_API_KEY) {
      errors.push({
        field: 'RESEND_API_KEY',
        message: 'Resend API key is required when using Resend email provider',
        fix: 'Set RESEND_API_KEY environment variable',
      });
    }
  } else if (emailProvider === 'smtp') {
    if (!process.env.KPH_SMTP_HOST) {
      errors.push({
        field: 'KPH_SMTP_HOST',
        message: 'SMTP host is required when using SMTP email provider',
        fix: 'Set KPH_SMTP_HOST environment variable',
      });
    }
    if (!process.env.KPH_SMTP_USER) {
      errors.push({
        field: 'KPH_SMTP_USER',
        message: 'SMTP username is required when using SMTP email provider',
        fix: 'Set KPH_SMTP_USER environment variable',
      });
    }
    if (!process.env.KPH_SMTP_PASSWORD) {
      errors.push({
        field: 'KPH_SMTP_PASSWORD',
        message: 'SMTP password is required when using SMTP email provider',
        fix: 'Set KPH_SMTP_PASSWORD environment variable',
      });
    }
  }

  // Validate Database Configuration
  if (!process.env.DATABASE_URL) {
    errors.push({
      field: 'DATABASE_URL',
      message: 'Database connection URL is required',
      fix: 'Set DATABASE_URL environment variable',
    });
  }

  // Report errors if any
  if (errors.length > 0) {
    console.error('\n┌────────────────────────────────────────────────────────────┐');
    console.error('│  ❌ CONFIGURATION ERRORS                                   │');
    console.error('└────────────────────────────────────────────────────────────┘\n');

    errors.forEach((error, index) => {
      console.error(`${index + 1}. ${error.message}`);
      console.error(`   Field: ${error.field}`);
      console.error(`   Fix: ${error.fix}\n`);
    });

    console.error('Documentation: https://github.com/kubenetlabs/kph#configuration\n');

    throw new Error(
      `Configuration validation failed with ${errors.length} error${errors.length > 1 ? 's' : ''}. ` +
      'Fix the errors above and restart the application.'
    );
  }

  // Success message
  console.log('✅ Configuration validated successfully');
  console.log(`   Auth: ${authProvider}`);
  console.log(`   LLM: ${llmProvider || 'disabled'}`);
  console.log(`   Email: ${emailProvider || 'none'}`);
}

/**
 * Validates database connectivity
 * Used by health checks
 */
export async function validateDatabaseConnection(): Promise<boolean> {
  try {
    const { db } = await import('./db');
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('[health] Database connection failed:', error);
    return false;
  }
}
