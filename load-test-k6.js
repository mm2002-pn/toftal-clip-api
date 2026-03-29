import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ==========================================
// CONFIGURATION DES UTILISATEURS DE TEST
// ==========================================
// 50 utilisateurs de test créés en production
// Pour 10,000 VUs, on cycle à travers les users (200 VUs par user)
const TEST_USERS = Array.from({ length: 50 }, (_, i) => ({
  email: `loadtest_user${i + 1}@test.com`,
  password: 'LoadTest@123!',
}));

// ==========================================
// MÉTRIQUES PERSONNALISÉES
// ==========================================
const authSuccessRate = new Rate('auth_success_rate');
const authFailureRate = new Rate('auth_failure_rate');
const graphqlSuccessRate = new Rate('graphql_success_rate');
const graphqlFailureRate = new Rate('graphql_failure_rate');

const authDuration = new Trend('auth_duration');
const graphqlSimpleDuration = new Trend('graphql_simple_duration');
const graphqlComplexDuration = new Trend('graphql_complex_duration');

const rateLimitErrors = new Counter('rate_limit_errors');
const authErrors = new Counter('auth_errors');
const graphqlErrors = new Counter('graphql_errors');

// ==========================================
// OPTIONS DE TEST K6 - 10,000 VUs
// ==========================================
export const options = {
  stages: [
    // Phase 1: Warm-up progressif
    { duration: '3m', target: 100 },    // Monter à 100 users en 3min
    { duration: '3m', target: 500 },    // Monter à 500 users en 3min

    // Phase 2: Ramp-up vers la charge cible
    { duration: '4m', target: 1000 },   // Monter à 1,000 users en 4min
    { duration: '4m', target: 2500 },   // Monter à 2,500 users en 4min
    { duration: '4m', target: 5000 },   // Monter à 5,000 users en 4min
    { duration: '4m', target: 7500 },   // Monter à 7,500 users en 4min
    { duration: '4m', target: 10000 },  // Atteindre 10,000 users en 4min

    // Phase 3: Maintien de la charge maximale
    { duration: '10m', target: 10000 }, // Maintenir 10,000 users pendant 10min

    // Phase 4: Cool-down progressif
    { duration: '3m', target: 5000 },   // Redescendre à 5,000 users en 3min
    { duration: '3m', target: 1000 },   // Redescendre à 1,000 users en 3min
    { duration: '2m', target: 100 },    // Redescendre à 100 users en 2min
    { duration: '2m', target: 0 },      // Retour à 0 en 2min
  ],

  // Seuils ajustés pour 10,000 VUs
  thresholds: {
    'http_req_duration': ['p(95)<1000', 'p(99)<3000'],  // P95 < 1s, P99 < 3s
    'http_req_failed': ['rate<0.10'],                    // Moins de 10% d'erreurs
    'auth_success_rate': ['rate>0.90'],                  // 90%+ auth success
    'graphql_success_rate': ['rate>0.85'],               // 85%+ GraphQL success
    'graphql_complex_duration': ['p(95)<1500'],          // Requêtes complexes < 1.5s
  },
};

// ==========================================
// CONFIGURATION API
// ==========================================
const BASE_URL = __ENV.API_URL || 'https://toftal-clip-api-776016345965.europe-west1.run.app/api/v1';
const GRAPHQL_URL = __ENV.GRAPHQL_URL || 'https://toftal-clip-api-776016345965.europe-west1.run.app/graphql';

// ==========================================
// FONCTION PRINCIPALE DE TEST
// ==========================================
export default function () {
  // Assigner un utilisateur unique par VU (cycle sur les 50 users)
  const userIndex = (__VU - 1) % TEST_USERS.length;
  const user = TEST_USERS[userIndex];

  let authToken = '';

  // ==========================================
  // 1. AUTHENTIFICATION
  // ==========================================
  group('Authentication', function () {
    const startAuth = Date.now();

    const loginPayload = JSON.stringify({
      email: user.email,
      password: user.password,
    });

    const loginParams = {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'Login' },
    };

    const loginResponse = http.post(`${BASE_URL}/auth/login`, loginPayload, loginParams);
    const authTime = Date.now() - startAuth;
    authDuration.add(authTime);

    const loginSuccess = check(loginResponse, {
      'Login status is 200': (r) => r.status === 200,
      'Login response has token': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.accessToken;
        } catch (e) {
          return false;
        }
      },
    });

    if (loginSuccess) {
      authSuccessRate.add(1);
      try {
        const data = JSON.parse(loginResponse.body);
        authToken = data.data.accessToken;
      } catch (e) {
        console.error(`[VU ${__VU}] Token extraction error:`, e);
        authErrors.add(1);
      }
    } else {
      authFailureRate.add(1);
      authErrors.add(1);

      // Vérifier si c'est un rate limit error
      if (loginResponse.status === 429) {
        rateLimitErrors.add(1);
        console.warn(`[VU ${__VU}] Rate limit hit for ${user.email}`);
      }

      // Si auth échoue, on arrête cette itération
      return;
    }
  });

  // Pause entre authentification et requêtes
  sleep(1);

  // ==========================================
  // 2. GET CURRENT USER
  // ==========================================
  if (authToken) {
    group('Get Current User', function () {
      const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      const response = http.get(`${BASE_URL}/auth/me`, {
        headers,
        tags: { name: 'GetMe' }
      });

      check(response, {
        'Get me status is 200': (r) => r.status === 200,
        'Get me has user data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.id;
          } catch (e) {
            return false;
          }
        },
      });
    });

    sleep(1);
  }

  // ==========================================
  // 3. GRAPHQL - LIST PROJECTS (Simple)
  // ==========================================
  if (authToken) {
    group('GraphQL - List Projects', function () {
      const startTime = Date.now();

      const query = `
        query {
          projects(pagination: { page: 1, limit: 10 }) {
            data {
              id
              title
              status
              createdAt
            }
            pageInfo {
              total
              page
              limit
            }
          }
        }
      `;

      const payload = JSON.stringify({ query });
      const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      const response = http.post(GRAPHQL_URL, payload, {
        headers,
        tags: { name: 'ListProjects' }
      });

      const duration = Date.now() - startTime;
      graphqlSimpleDuration.add(duration);

      const success = check(response, {
        'List projects status is 200': (r) => r.status === 200,
        'List projects has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.projects;
          } catch (e) {
            return false;
          }
        },
      });

      if (success) {
        graphqlSuccessRate.add(1);
      } else {
        graphqlFailureRate.add(1);
        graphqlErrors.add(1);
      }
    });

    sleep(1);
  }

  // ==========================================
  // 4. GRAPHQL - LIST TALENTS (Simple)
  // ==========================================
  if (authToken) {
    group('GraphQL - List Talents', function () {
      const query = `
        query {
          talents(pagination: { page: 1, limit: 20 }) {
            data {
              id
              user {
                name
                email
              }
              verified
              rating
            }
          }
        }
      `;

      const payload = JSON.stringify({ query });
      const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      const response = http.post(GRAPHQL_URL, payload, {
        headers,
        tags: { name: 'ListTalents' }
      });

      const success = check(response, {
        'List talents status is 200': (r) => r.status === 200,
        'List talents has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.talents;
          } catch (e) {
            return false;
          }
        },
      });

      if (success) {
        graphqlSuccessRate.add(1);
      } else {
        graphqlFailureRate.add(1);
        graphqlErrors.add(1);
      }
    });

    sleep(1);
  }

  // ==========================================
  // 5. GRAPHQL - PROJECTS WITH DELIVERABLES (Complex - DataLoader Test)
  // ==========================================
  if (authToken) {
    group('GraphQL - Projects with Deliverables', function () {
      const startTime = Date.now();

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
                progress
                assignedTalent {
                  id
                  name
                  email
                  avatarUrl
                }
              }
            }
          }
        }
      `;

      const payload = JSON.stringify({ query });
      const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      const response = http.post(GRAPHQL_URL, payload, {
        headers,
        tags: { name: 'ProjectsWithDeliverables' }
      });

      const duration = Date.now() - startTime;
      graphqlComplexDuration.add(duration);

      const success = check(response, {
        'Projects with deliverables status is 200': (r) => r.status === 200,
        'Has deliverables data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.projects && body.data.projects.data;
          } catch (e) {
            return false;
          }
        },
        'DataLoader working (no errors)': (r) => {
          try {
            const body = JSON.parse(r.body);
            return !body.errors;
          } catch (e) {
            return false;
          }
        },
      });

      if (success) {
        graphqlSuccessRate.add(1);
      } else {
        graphqlFailureRate.add(1);
        graphqlErrors.add(1);

        // Log des erreurs GraphQL complexes pour debug
        if (response.status !== 200) {
          console.error(`[VU ${__VU}] Complex GraphQL failed: ${response.status}`);
        }
      }
    });

    sleep(2);
  }

  // Pause finale entre itérations
  sleep(1);
}

// ==========================================
// RÉSUMÉ FINAL
// ==========================================
export function handleSummary(data) {
  return {
    'stdout': generateTextSummary(data),
    'load-test-results/summary.json': JSON.stringify(data, null, 2),
    'load-test-results/summary.html': generateHtmlSummary(data),
  };
}

function generateTextSummary(data) {
  const metrics = data.metrics;

  let summary = '\n';
  summary += '════════════════════════════════════════════════════════════\n';
  summary += '   TOFTAL CLIP - RÉSULTATS TEST DE CHARGE K6 (10,000 VUs)\n';
  summary += '════════════════════════════════════════════════════════════\n\n';

  // Statistiques HTTP
  if (metrics.http_req_duration && metrics.http_req_duration.values) {
    const httpDuration = metrics.http_req_duration.values;
    summary += 'LATENCE HTTP:\n';
    summary += `  Min:     ${Math.round(httpDuration.min || 0)} ms\n`;
    summary += `  Max:     ${Math.round(httpDuration.max || 0)} ms\n`;
    summary += `  Moyenne: ${Math.round(httpDuration.avg || 0)} ms\n`;
    summary += `  P95:     ${Math.round(httpDuration['p(95)'] || 0)} ms`;
    summary += httpDuration['p(95)'] < 500 ? ' ✅\n' : ' ❌\n';
    summary += `  P99:     ${Math.round(httpDuration['p(99)'] || 0)} ms`;
    summary += httpDuration['p(99)'] < 1000 ? ' ✅\n\n' : ' ❌\n\n';
  }

  // Taux d'erreur
  if (metrics.http_req_failed && metrics.http_req_failed.values) {
    const errorRate = metrics.http_req_failed.values.rate * 100;
    summary += `TAUX D'ERREUR: ${errorRate.toFixed(2)}%`;
    summary += errorRate < 5 ? ' ✅\n\n' : ' ❌\n\n';
  }

  // Taux de succès Auth
  if (metrics.auth_success_rate && metrics.auth_success_rate.values) {
    const authRate = metrics.auth_success_rate.values.rate * 100;
    summary += `AUTHENTIFICATION: ${authRate.toFixed(2)}% succès`;
    summary += authRate > 95 ? ' ✅\n' : ' ❌\n';
  }

  // Taux de succès GraphQL
  if (metrics.graphql_success_rate && metrics.graphql_success_rate.values) {
    const gqlRate = metrics.graphql_success_rate.values.rate * 100;
    summary += `GRAPHQL: ${gqlRate.toFixed(2)}% succès`;
    summary += gqlRate > 90 ? ' ✅\n\n' : ' ❌\n\n';
  }

  // Erreurs Rate Limit
  if (metrics.rate_limit_errors && metrics.rate_limit_errors.values) {
    const rateLimitCount = metrics.rate_limit_errors.values.count;
    summary += `RATE LIMIT ERRORS: ${rateLimitCount}`;
    summary += rateLimitCount === 0 ? ' ✅\n\n' : ' ⚠️\n\n';
  }

  // Volume
  if (metrics.http_reqs && metrics.http_reqs.values) {
    summary += `REQUÊTES TOTALES: ${metrics.http_reqs.values.count}\n`;
    summary += `DÉBIT: ${metrics.http_reqs.values.rate.toFixed(2)} req/s\n\n`;
  }

  summary += '════════════════════════════════════════════════════════════\n';
  summary += '✅ Test complété! Voir load-test-results/ pour détails\n';
  summary += '════════════════════════════════════════════════════════════\n\n';

  return summary;
}

function generateHtmlSummary(data) {
  const metrics = data.metrics;
  const httpDuration = metrics.http_req_duration?.values || {};
  const errorRate = (metrics.http_req_failed?.values?.rate || 0) * 100;
  const authRate = (metrics.auth_success_rate?.values?.rate || 0) * 100;
  const gqlRate = (metrics.graphql_success_rate?.values?.rate || 0) * 100;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>K6 Load Test Results - Toftal Clip</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
    h1 { color: #333; border-bottom: 3px solid #4CAF50; padding-bottom: 10px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
    .metric-card { background: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 4px solid #4CAF50; }
    .metric-card.warning { border-left-color: #ff9800; }
    .metric-card.error { border-left-color: #f44336; }
    .metric-value { font-size: 32px; font-weight: bold; color: #333; }
    .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
    .status-ok { color: #4CAF50; }
    .status-warning { color: #ff9800; }
    .status-error { color: #f44336; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Toftal Clip - Load Test Results (10,000 VUs)</h1>

    <div class="metric-grid">
      <div class="metric-card ${httpDuration['p(95)'] < 500 ? '' : 'error'}">
        <div class="metric-value">${Math.round(httpDuration['p(95)'] || 0)}ms</div>
        <div class="metric-label">P95 Latency ${httpDuration['p(95)'] < 500 ? '✅' : '❌'}</div>
      </div>

      <div class="metric-card ${errorRate < 5 ? '' : 'error'}">
        <div class="metric-value">${errorRate.toFixed(1)}%</div>
        <div class="metric-label">Error Rate ${errorRate < 5 ? '✅' : '❌'}</div>
      </div>

      <div class="metric-card ${authRate > 95 ? '' : 'warning'}">
        <div class="metric-value">${authRate.toFixed(1)}%</div>
        <div class="metric-label">Auth Success ${authRate > 95 ? '✅' : '⚠️'}</div>
      </div>

      <div class="metric-card ${gqlRate > 90 ? '' : 'warning'}">
        <div class="metric-value">${gqlRate.toFixed(1)}%</div>
        <div class="metric-label">GraphQL Success ${gqlRate > 90 ? '✅' : '⚠️'}</div>
      </div>
    </div>

    <h2>Detailed Metrics</h2>
    <pre>${JSON.stringify(data.metrics, null, 2)}</pre>
  </div>
</body>
</html>
  `;
}
