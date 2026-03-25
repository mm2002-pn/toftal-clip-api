import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Configuration des étapes de charge
export const options = {
  stages: [
    { duration: '2m', target: 5 },   // Ramp-up à 5 utilisateurs en 2 minutes
    { duration: '5m', target: 20 },  // Augmenter à 20 utilisateurs en 5 minutes
    { duration: '5m', target: 50 },  // Augmenter à 50 utilisateurs en 5 minutes
    { duration: '5m', target: 20 },  // Réduire à 20 utilisateurs en 5 minutes
    { duration: '2m', target: 0 },   // Ramener à 0 en 2 minutes
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1000ms
    'http_req_failed': ['rate<0.1'],                   // Moins de 10% d'erreurs
  },
};

// Configuration
const BASE_URL = 'http://localhost:4000/api/v1';
const GRAPHQL_URL = 'http://localhost:4000/graphql';

// Variables globales
let authToken = '';

export default function () {
  // ======================
  // 1. AUTHENTIFICATION
  // ======================
  group('Authentication', function () {
    const loginPayload = JSON.stringify({
      email: 'admin@toftalclip.com',
      password: 'Admin@123!',
    });

    const loginParams = {
      headers: { 'Content-Type': 'application/json' },
    };

    const loginResponse = http.post(`${BASE_URL}/auth/login`, loginPayload, loginParams);

    check(loginResponse, {
      'Login status is 200': (r) => r.status === 200,
      'Login response has token': (r) => r.body.includes('accessToken'),
    });

    // Extraire le token
    if (loginResponse.status === 200) {
      try {
        const data = JSON.parse(loginResponse.body);
        authToken = data.data.accessToken;
      } catch (e) {
        console.error('Erreur extraction token:', e);
      }
    }
  });

  sleep(1);

  // ======================
  // 2. GET CURRENT USER
  // ======================
  group('Get Current User', function () {
    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    const response = http.get(`${BASE_URL}/auth/me`, { headers });

    check(response, {
      'Get me status is 200': (r) => r.status === 200,
      'Get me has user data': (r) => r.body.includes('id'),
    });
  });

  sleep(1);

  // ======================
  // 3. GRAPHQL - LIST PROJECTS
  // ======================
  group('GraphQL - List Projects', function () {
    const query = `
      query {
        projects(pagination: { page: 1, limit: 10 }) {
          data {
            id
            title
            status
            createdAt
          }
        }
      }
    `;

    const payload = JSON.stringify({ query });

    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    const response = http.post(GRAPHQL_URL, payload, { headers });

    check(response, {
      'List projects status is 200': (r) => r.status === 200,
      'List projects has data': (r) => r.body.includes('data'),
    });
  });

  sleep(1);

  // ======================
  // 4. GRAPHQL - LIST TALENTS
  // ======================
  group('GraphQL - List Talents', function () {
    const query = `
      query {
        talents(pagination: { page: 1, limit: 20 }) {
          data {
            id
            user {
              name
            }
            verified
          }
        }
      }
    `;

    const payload = JSON.stringify({ query });

    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    const response = http.post(GRAPHQL_URL, payload, { headers });

    check(response, {
      'List talents status is 200': (r) => r.status === 200,
      'List talents has data': (r) => r.body.includes('data'),
    });
  });

  sleep(1);

  // ======================
  // 5. GRAPHQL - PROJECTS WITH DELIVERABLES
  // ======================
  group('GraphQL - Projects with Deliverables', function () {
    const query = `
      query {
        projects(pagination: { page: 1, limit: 5 }) {
          data {
            id
            title
            status
            deliverables {
              id
              title
              status
              assignedTalent {
                id
                user {
                  name
                }
              }
            }
          }
        }
      }
    `;

    const payload = JSON.stringify({ query });

    const headers = {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    const response = http.post(GRAPHQL_URL, payload, { headers });

    check(response, {
      'Projects with deliverables status is 200': (r) => r.status === 200,
      'Has deliverables data': (r) => r.body.includes('deliverables'),
    });
  });

  sleep(1);
}

// Résumé final
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-results/summary.json': JSON.stringify(data),
  };
}

// Texte résumé
function textSummary(data, options) {
  const indent = options.indent || '  ';
  const colors = options.enableColors || false;

  let summary = '\n';
  summary += '════════════════════════════════════════════════════════════\n';
  summary += '         TOFTAL CLIP - RÉSUMÉ TEST DE CHARGE K6\n';
  summary += '════════════════════════════════════════════════════════════\n\n';

  // Statistiques globales
  if (data.metrics) {
    const httpDuration = data.metrics.http_req_duration;
    const httpFailed = data.metrics.http_req_failed;

    if (httpDuration && httpDuration.values) {
      summary += 'LATENCE HTTP:\n';
      summary += `${indent}Min:     ${Math.round(httpDuration.values.min || 0)} ms\n`;
      summary += `${indent}Max:     ${Math.round(httpDuration.values.max || 0)} ms\n`;
      summary += `${indent}Moyenne: ${Math.round(httpDuration.values.avg || 0)} ms\n`;
      summary += `${indent}P95:     ${Math.round(httpDuration.values['p(95)'] || 0)} ms\n`;
      summary += `${indent}P99:     ${Math.round(httpDuration.values['p(99)'] || 0)} ms\n\n`;
    }

    if (httpFailed && httpFailed.values) {
      summary += `TAUX D'ERREUR:\n`;
      summary += `${indent}${(httpFailed.values.value * 100).toFixed(2)}%\n\n`;
    }
  }

  summary += '════════════════════════════════════════════════════════════\n';
  summary += '✅ Test complété! Vérifier load-test-results/summary.json\n';
  summary += '════════════════════════════════════════════════════════════\n\n';

  return summary;
}
