(() => {
  const adapterScript = document.currentScript;
  const catalogueUrl = adapterScript ? new URL('./courses.json', adapterScript.src).href : './courses.json';
  let cataloguePromise;
  let demoCourses = null;

  const DOMAIN_COLORS = {
    'Finance': '#2d5bff',
    'Marketing': '#16a34a',
    'OB / HR': '#9333ea',
    'OB / Leadership': '#7c3aed',
    'Entrepreneurship / Strategy': '#ea580c',
    'Strategy': '#dc2626',
    'Technology / AI': '#0891b2',
    'Accounting': '#b45309',
    'Economics': '#0d9488',
    'Operations Management': '#65a30d',
    'Public Policy': '#6366f1',
    'Communication': '#db2777',
    'Sustainability / ESG': '#15803d',
    'Humanities / Indian Knowledge': '#92400e',
    'Language': '#be185d',
    'Marketing / Research': '#047857',
    'Career Development': '#d97706'
  };

  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  const cloneCourses = () => demoCourses.map(course => ({ ...course }));

  async function loadCatalogue() {
    if (!cataloguePromise) {
      cataloguePromise = window.fetch(catalogueUrl)
        .then(response => {
          if (!response.ok) throw new Error('Catalogue file could not be loaded.');
          return response.json();
        })
        .then(courses => {
          demoCourses = Array.isArray(courses) ? courses : [];
          return demoCourses;
        });
    }
    return cataloguePromise;
  }

  const tokens = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9/+# ]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);

  const courseText = (course) => [
    course.name, course.domain, course.level, course.instructor,
    course.description, course.eligibility, course.pace
  ].join(' ');

  function buildGraph(courses) {
    const nodes = courses.map(course => ({
      id: course.id,
      label: course.name.length > 25 ? `${course.name.slice(0, 24)}…` : course.name,
      fullName: course.name,
      domain: course.domain,
      level: course.level,
      color: DOMAIN_COLORS[course.domain] || '#64748b',
      title: `${course.name} · local demo record`
    }));
    const edges = [];
    const seen = new Set();
    const addEdge = (from, to, arrows = 'to') => {
      const key = `${Math.min(from, to)}-${Math.max(from, to)}`;
      if (from === to || seen.has(key)) return;
      seen.add(key);
      edges.push({ id: key, from, to, arrows, color: '#cbd5e1', width: 1 });
    };

    const byDomain = new Map();
    courses.forEach(course => {
      if (!byDomain.has(course.domain)) byDomain.set(course.domain, []);
      byDomain.get(course.domain).push(course);
    });
    byDomain.forEach(group => {
      for (let index = 1; index < group.length; index += 1) addEdge(group[index - 1].id, group[index].id);
    });

    const byInstructor = new Map();
    courses.forEach(course => {
      if (!course.instructor) return;
      if (!byInstructor.has(course.instructor)) byInstructor.set(course.instructor, []);
      byInstructor.get(course.instructor).push(course);
    });
    byInstructor.forEach(group => {
      for (let index = 1; index < group.length; index += 1) addEdge(group[index - 1].id, group[index].id);
    });

    return { nodes, edges, domainColors: DOMAIN_COLORS };
  }

  async function staticApi(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const method = (options.method || (typeof input !== 'string' ? input.method : 'GET')).toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    await loadCatalogue();

    if (url.pathname === '/api/courses' && method === 'GET') return jsonResponse(cloneCourses());

    if (url.pathname === '/api/courses' && method === 'POST') {
      const nextId = demoCourses.reduce((max, course) => Math.max(max, Number(course.id) || 0), 0) + 1;
      const created = { id: nextId, ...body };
      demoCourses.push(created);
      return jsonResponse(created, 201);
    }

    const courseMatch = url.pathname.match(/^\/api\/courses\/(\d+)$/);
    if (courseMatch && ['PUT', 'DELETE'].includes(method)) {
      const id = Number(courseMatch[1]);
      const index = demoCourses.findIndex(course => Number(course.id) === id);
      if (index < 0) return jsonResponse({ error: 'Course not found' }, 404);
      if (method === 'DELETE') {
        demoCourses.splice(index, 1);
        return jsonResponse({ ok: true });
      }
      demoCourses[index] = { ...demoCourses[index], ...body, id };
      return jsonResponse(demoCourses[index]);
    }

    if (url.pathname === '/api/graph' && method === 'GET') return jsonResponse(buildGraph(demoCourses));

    if (url.pathname === '/api/suggest' && method === 'POST') {
      const query = String(body.query || '').trim();
      const filters = body.filters || {};
      const domains = Array.isArray(filters.domains) ? filters.domains : [];
      const levels = Array.isArray(filters.levels) ? filters.levels : [];
      const eligibilities = Array.isArray(filters.eligibilities) ? filters.eligibilities : [];
      if (!query && !domains.length && !levels.length && !eligibilities.length) {
        return jsonResponse({ error: 'Query or filters required' }, 400);
      }

      const queryTokens = new Set(tokens(query));
      const eligible = demoCourses.filter(course => {
        const statusOkay = course.status === 'Active' || course.status === 'Coming Soon' || !course.status;
        const domainOkay = !domains.length || domains.includes(course.domain);
        const levelOkay = !levels.length || levels.includes(course.level);
        const eligibilityOkay = !eligibilities.length || eligibilities.includes(course.eligibility);
        return statusOkay && domainOkay && levelOkay && eligibilityOkay;
      });

      const ranked = eligible.map(course => {
        const textTokens = tokens(courseText(course));
        const overlap = [...queryTokens].filter(token => textTokens.includes(token));
        const domainHit = queryTokens.has(String(course.domain || '').toLowerCase()) ? 2 : 0;
        return { course, score: overlap.length + domainHit, overlap };
      }).sort((a, b) => b.score - a.score || String(a.course.name).localeCompare(String(b.course.name)));

      const selected = ranked.slice(0, 20).map(({ course, overlap }) => ({
        ...course,
        reason: overlap.length
          ? `Matches ${overlap.slice(0, 4).join(', ')} in ${course.domain}.`
          : `A useful ${course.level || 'foundational'} option in ${course.domain}.`
      }));
      const visibleDomains = [...new Set(selected.map(course => course.domain))];
      const visibleLevels = [...new Set(selected.map(course => course.level))];
      const overallRecommendation = `Based on your brief, we found ${selected.length} relevant courses across ${visibleDomains.join(', ') || 'the fictional catalogue'}. The shortlist spans ${visibleLevels.join(', ') || 'multiple levels'} and is ranked locally for demonstration.`;
      return jsonResponse({
        recommendedCourses: selected,
        overallRecommendation,
        source: 'static-demo',
        warning: 'Local deterministic recommendations are active; a server-side Groq key can be added later.'
      });
    }

    return window.fetch(input, options);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.pathname.startsWith('/api/')) return staticApi(input, options);
    return originalFetch(input, options);
  };
})();
