import { config } from './src/config';
import { chatCompletion } from './src/config/groq';

async function test() {
  console.log('=== GROQ CONFIG TEST ===');
  console.log('API Key exists:', !!config.groq.apiKey);
  console.log('API Key prefix:', config.groq.apiKey?.substring(0, 15));
  console.log('Base URL:', config.groq.baseUrl);
  console.log('Model:', config.groq.models.fast);
  console.log('========================');

  if (!config.groq.apiKey) {
    console.log('ERROR: No API key found!');
    process.exit(1);
  }

  console.log('\nTesting chat completion...');
  try {
    const result = await chatCompletion([
      { role: 'user', content: 'Dis bonjour' }
    ], { model: config.groq.models.fast, maxTokens: 50 });
    console.log('SUCCESS! Response:', result);
  } catch (error) {
    console.error('ERROR:', error);
  }
}

test();
