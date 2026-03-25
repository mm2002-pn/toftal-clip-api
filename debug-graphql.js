import http from 'k6/http';
import { check } from 'k6';

// Configuration simple - pas de stages, juste un test rapide
export const options = {
  vus: 1,
  duration: '30s',
};

const BASE_URL = 'http://localhost:4000/api/v1';
const GRAPHQL_URL = 'http://localhost:4000/graphql';

let authToken = '';

export default function () {
  // ===== STEP 1: LOGIN =====
  const loginPayload = JSON.stringify({
    email: 'admin@toftalclip.com',
    password: 'Admin@123!',
  });

  const loginResponse = http.post(`${BASE_URL}/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (loginResponse.status === 200) {
    try {
      const data = JSON.parse(loginResponse.body);
      authToken = data.data.accessToken;
      console.log('✅ Login OK, token:', authToken.substring(0, 20) + '...');
    } catch (e) {
      console.error('❌ Erreur parsing login response:', e);
    }
  } else {
    console.error('❌ Login échoué, status:', loginResponse.status);
    console.error('Body:', loginResponse.body);
  }

  // ===== STEP 2: TEST GRAPHQL =====
  const query = `
    query {
      projects(pagination: { page: 1, limit: 5 }) {
        data {
          id
          title
        }
      }
    }
  `;

  const graphqlPayload = JSON.stringify({ query });

  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  console.log('📤 Envoi requête GraphQL...');
  const graphqlResponse = http.post(GRAPHQL_URL, graphqlPayload, { headers });

  console.log('📥 Réponse status:', graphqlResponse.status);
  console.log('📥 Réponse body:', graphqlResponse.body);

  // ===== ANALYSE DÉTAILLÉE =====
  try {
    const responseData = JSON.parse(graphqlResponse.body);

    // Vérifier les erreurs GraphQL
    if (responseData.errors) {
      console.error('❌ ERREURS GRAPHQL:');
      responseData.errors.forEach((err, idx) => {
        console.error(`   Erreur ${idx + 1}:`, err.message);
        if (err.locations) console.error('   Localisation:', err.locations);
      });
    }

    // Vérifier les données
    if (responseData.data) {
      console.log('✅ Données reçues:', JSON.stringify(responseData.data).substring(0, 100) + '...');
    }

    // Vérifier les extensions (peuvent contenir des infos utiles)
    if (responseData.extensions) {
      console.log('📊 Extensions:', JSON.stringify(responseData.extensions));
    }
  } catch (e) {
    console.error('❌ Erreur parsing GraphQL response:', e);
    console.error('Raw body:', graphqlResponse.body);
  }

  check(graphqlResponse, {
    'status is 200': (r) => r.status === 200,
  });
}
