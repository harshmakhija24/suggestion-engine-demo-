require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const natural = require('natural');

const app = express();
const PORT = process.env.PORT || 3000;
const COURSES_FILE = path.join(__dirname, 'courses.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
  }
}));

// ── Rate limiting ──────────────────────────────────────────────────────────────
const suggestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: { error: 'Rate limit reached: max 50 suggestions per hour. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const dailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 200,
  message: { error: 'Daily limit reached: max 200 suggestions per day.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const minuteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function readCourses() {
  return JSON.parse(fs.readFileSync(COURSES_FILE, 'utf-8'));
}

function writeCourses(courses) {
  fs.writeFileSync(COURSES_FILE, JSON.stringify(courses, null, 2), 'utf-8');
}

// ── Domain keyword map (expanded) ─────────────────────────────────────────────
const DOMAIN_KEYWORDS = {
  'Finance': ['bank', 'banking', 'nbfc', 'fintech', 'financial', 'finance', 'investment',
    'investing', 'wealth', 'stock', 'market', 'trading', 'securities', 'insurance',
    'insurtech', 'corporate finance', 'capital', 'blockchain', 'treasury', 'risk',
    'credit', 'loan', 'bfsi', 'mutual fund', 'portfolio', 'equity', 'debt', 'rbi',
    'sebi', 'microfinance', 'valuation', 'fintech', 'banking regulation'],
  'Marketing': ['marketing', 'sales', 'brand', 'customer', 'consumer', 'digital marketing',
    'crm', 'advertising', 'market research', 'b2b', 'b2c', 'growth', 'revenue',
    'product', 'campaign', 'pricing', 'branding', 'customer relationship'],
  'OB / HR': ['hr', 'human resources', 'people', 'talent', 'workforce', 'employees',
    'hiring', 'recruitment', 'performance management', 'training', 'engagement',
    'appraisal', 'compensation', 'learning and development', 'l&d', 'retention'],
  'OB / Leadership': ['leadership', 'leader', 'management', 'culture', 'organization',
    'team', 'motivation', 'influence', 'decision making', 'executive', 'manager',
    'leadership development', 'leading', 'people management'],
  'Entrepreneurship / Strategy': ['startup', 'founder', 'venture', 'entrepreneur',
    'business model', 'innovation', 'product development', 'family business', 'platform',
    'scale', 'pivot', 'incubator', 'new business', 'venture capital', 'entrepreneurship'],
  'Strategy': ['strategy', 'strategic', 'competitive', 'corporate strategy',
    'diversification', 'expansion', 'merger', 'acquisition', 'strategic management',
    'competitive advantage', 'business strategy'],
  'Technology / AI': ['ai', 'artificial intelligence', 'machine learning', 'deep learning',
    'technology', 'tech', 'digital', 'data', 'llm', 'generative ai', 'product management',
    'digital transformation', 'automation', 'analytics', 'data science', 'neural network',
    'nlp', 'computer vision', 'ml', 'chatgpt', 'language model'],
  'Accounting': ['accounting', 'financial statements', 'audit', 'cost', 'budgeting',
    'balance sheet', 'p&l', 'variance', 'costing', 'bookkeeping', 'financial reporting',
    'accounts', 'taxation', 'ifrs'],
  'Economics': ['economics', 'macro', 'micro', 'policy', 'gdp', 'inflation', 'monetary',
    'fiscal', 'market economics', 'demand', 'supply', 'economic', 'managerial economics',
    'behavioural economics'],
  'Operations Management': ['operations', 'lean', 'manufacturing', 'supply chain',
    'logistics', 'process', 'efficiency', 'six sigma', 'quality', 'production',
    'operations management', 'process improvement'],
  'Public Policy': ['policy', 'government', 'public sector', 'infrastructure', 'ppp',
    'regulation', 'governance', 'compliance', 'public administration', 'regulatory'],
  'Communication': ['communication', 'writing', 'presentation', 'speaking', 'messaging',
    'stakeholder', 'business communication', 'health communication'],
  'Sustainability / ESG': ['sustainability', 'esg', 'environment', 'green', 'climate',
    'carbon', 'corporate responsibility', 'sdg', 'sustainable', 'csr'],
  'Humanities / Indian Knowledge': ['culture', 'philosophy', 'indian knowledge',
    'humanities', 'social science', 'history', 'ethics', 'indian', 'knowledge system'],
  'Language': ['french', 'language', 'linguistic', 'foreign language'],
  'Marketing / Research': ['market research', 'quantitative research', 'research methodology',
    'survey', 'data analysis', 'marketing analytics'],
  'Career Development': ['career', 'job', 'resume', 'interview', 'professional development',
    'career planning', 'career path', 'career design'],
};

// ── TF-IDF Engine ──────────────────────────────────────────────────────────────
function buildTfIdf(courses) {
  const tfidf = new natural.TfIdf();
  courses.forEach(c => {
    const doc = [
      c.name, c.domain, c.instructor,
      c.description,
      Array.isArray(c.whatYouWillLearn) ? c.whatYouWillLearn.join(' ') : '',
      Array.isArray(c.curriculum) ? c.curriculum.join(' ') : '',
    ].join(' ');
    tfidf.addDocument(doc);
  });
  return tfidf;
}

function getRelevantDomains(query) {
  const q = query.toLowerCase();
  const domainScores = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) score += kw.split(' ').length; // multi-word keywords score higher
    }
    if (score > 0) domainScores[domain] = score;
  }
  return domainScores;
}

function runTfIdf(query, courses) {
  const tfidf = buildTfIdf(courses);
  const scores = [];
  tfidf.tfidfs(query, (i, measure) => {
    scores.push({ course: courses[i], score: measure });
  });
  const sorted = scores.sort((a, b) => b.score - a.score);

  // If all TF-IDF scores are 0, fall back to domain keyword scoring
  const hasSignal = sorted.some(s => s.score > 0);
  if (!hasSignal) {
    const domainScores = getRelevantDomains(query);
    return courses
      .map(c => ({ course: c, score: domainScores[c.domain] || 0 }))
      .filter(s => s.score > 0)  // only return domain-matched courses
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);             // cap at 20
  }

  // Return only courses with actual relevance, max 20
  return sorted.filter(s => s.score > 0).slice(0, 20);
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET all courses
app.get('/api/courses', (req, res) => {
  res.json(readCourses());
});

// PUT update a course
app.put('/api/courses/:id', (req, res) => {
  const courses = readCourses();
  const idx = courses.findIndex(c => c.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Course not found' });
  courses[idx] = { ...courses[idx], ...req.body, id: courses[idx].id };
  writeCourses(courses);
  res.json(courses[idx]);
});

// POST add a new course
app.post('/api/courses', (req, res) => {
  const courses = readCourses();
  const newId = Math.max(...courses.map(c => c.id)) + 1;
  const newCourse = { id: newId, ...req.body };
  courses.push(newCourse);
  writeCourses(courses);
  res.status(201).json(newCourse);
});

// DELETE a course
app.delete('/api/courses/:id', (req, res) => {
  const courses = readCourses();
  const filtered = courses.filter(c => c.id !== parseInt(req.params.id));
  writeCourses(filtered);
  res.json({ ok: true });
});

// GET graph data (nodes + edges from courses)
app.get('/api/graph', (req, res) => {
  const courses = readCourses();

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
    'Career Development': '#d97706',
  };

  const nodes = courses.map(c => ({
    id: c.id,
    label: c.name.length > 30 ? c.name.substring(0, 28) + '…' : c.name,
    fullName: c.name,
    domain: c.domain,
    level: c.level,
    color: DOMAIN_COLORS[c.domain] || '#64748b',
    title: `${c.name}\n${c.domain} | ${c.level}`,
  }));

  const edges = [];
  // Edge: same instructor (shared faculty)
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i], b = courses[j];
      if (a.instructor && b.instructor) {
        const aInst = a.instructor.split(',').map(x => x.trim());
        const bInst = b.instructor.split(',').map(x => x.trim());
        const shared = aInst.some(x => bInst.includes(x));
        if (shared) edges.push({ from: a.id, to: b.id, type: 'instructor', color: '#cbd5e1' });
      }
    }
  }
  // Edge: progression (Intro → Intermediate → Advanced within domain)
  const levels = ['Introductory', 'Intermediate', 'Advanced'];
  const byDomainLevel = {};
  courses.forEach(c => {
    const key = c.domain;
    if (!byDomainLevel[key]) byDomainLevel[key] = {};
    if (!byDomainLevel[key][c.level]) byDomainLevel[key][c.level] = [];
    byDomainLevel[key][c.level].push(c.id);
  });

  for (const domain of Object.keys(byDomainLevel)) {
    for (let li = 0; li < levels.length - 1; li++) {
      const fromLevel = byDomainLevel[domain][levels[li]] || [];
      const toLevel = byDomainLevel[domain][levels[li + 1]] || [];
      fromLevel.forEach(fromId => {
        toLevel.forEach(toId => {
          edges.push({ from: fromId, to: toId, type: 'progression', color: '#fbbf24', arrows: 'to' });
        });
      });
    }
  }

  res.json({ nodes, edges, domainColors: DOMAIN_COLORS });
});

// POST suggest courses
app.use('/api/suggest', minuteLimiter, dailyLimiter, suggestLimiter);
app.post('/api/suggest', async (req, res) => {
  const { query = '', filters = {} } = req.body;
  if (!query.trim() && (!filters.domains || filters.domains.length === 0) && (!filters.levels || filters.levels.length === 0) && (!filters.eligibilities || filters.eligibilities.length === 0)) {
    return res.status(400).json({ error: 'Query or filters required' });
  }

  const courses = readCourses();

  // Filter by status (only Active + Coming Soon)
  let pool = courses.filter(c => c.status !== 'Inactive');

  // Apply manual filters from sidebar
  if (filters.domains && filters.domains.length > 0) pool = pool.filter(c => filters.domains.includes(c.domain));
  if (filters.levels && filters.levels.length > 0) pool = pool.filter(c => filters.levels.includes(c.level));
  if (filters.eligibilities && filters.eligibilities.length > 0) pool = pool.filter(c => filters.eligibilities.includes(c.eligibility));

  // TF-IDF scoring (or just take top 20 if no query)
  const tfidfScores = query.trim() ? runTfIdf(query, pool) : pool.slice(0, 20).map(course => ({ course, score: 1 }));

  // Domain keyword detection
  const relevantDomains = getRelevantDomains(query);
  const hasDomainFilter = Object.keys(relevantDomains).length > 0;

  // Section A: courses from relevant domains (full details for the language model)
  let sectionA = hasDomainFilter
    ? tfidfScores.filter(({ course }) => relevantDomains[course.domain] !== undefined)
    : tfidfScores; // already capped at 20 with score > 0 by runTfIdf

  // Merge in top TF-IDF scorers not already in sectionA (stays within the 20 cap)
  const sectionAIds = new Set(sectionA.map(s => s.course.id));
  const extras = tfidfScores.filter(s => !sectionAIds.has(s.course.id));
  sectionA = [...sectionA, ...extras].slice(0, 20); // hard cap: max 20 into the primary model context

  const sectionACourses = sectionA.map(x => x.course);

  // Section B: remaining courses (lightweight — just name, domain, level)
  const sectionAIdSet = new Set(sectionACourses.map(c => c.id));
  const sectionBCourses = pool.filter(c => !sectionAIdSet.has(c.id));

  // Build language-model prompt
  const sectionAText = sectionACourses.map(c => `
[${c.name}] | Domain: ${c.domain} | Level: ${c.level} | Duration: ${c.duration} | Price: ${c.price || 'Contact for pricing'}
Description: ${c.description || 'N/A'}
What You Will Learn: ${Array.isArray(c.whatYouWillLearn) ? c.whatYouWillLearn.join('; ') : 'N/A'}
Eligibility: ${c.eligibility} | Pace: ${c.pace}
`).join('\n---\n');

  const sectionBText = sectionBCourses.map(c =>
    `${c.name} | ${c.domain} | ${c.level}`
  ).join('\n');

  const clientContext = query.trim() 
    ? `A B2B client has sent the following query or email:\n\n"${query}"` 
    : `A B2B client is looking for course recommendations based on specific filters (e.g. Domain, Level, Eligibility) without providing a specific text query.`;

  const prompt = `You are a course advisor for the Course Intelligence demo, a fictional catalogue-management and recommendation workspace. 
${clientContext}

SECTION A — Pre-filtered primary course matches (review these carefully):
${sectionAText}

SECTION B — Full course index (scan for any additional relevant courses):
${sectionBText}

- Do NOT just summarize the results. You are an intelligent filter. You must discard courses from the TF-IDF results that match on keywords but fail on semantic intent.
- Analyze the Client: Identify the company's growth stage, department needs, and exact pain points before looking at the courses.
- Context is King: 
  - If a startup founder needs HR help, prioritize entrepreneur-focused HR courses over generic corporate ones.
  - If they mention physical operations (warehouses, shipping), prioritize specific logistics courses over broad operational theory.
  - If they need data tracking or KPI validation, prioritize foundational courses like "Business Statistics for Entrepreneurs".
- Strict Limitation: Limit your final recommendation to a highly curated list of 5 to 9 courses.
  - Zero Hallucination: You may ONLY recommend courses that are explicitly provided in the TF-IDF RESULTS block.

Format your response EXACTLY as valid JSON. Place your entire professional email response into the "overallRecommendation" field, and provide the structured course list in "recommendedCourses" for our system:
{
  "recommendedCourses": [
    {
      "name": "Course Name",
      "reason": "Why this fits the client"
    }
  ],
  "overallRecommendation": "Dear Client,\\n\\n[Full professional email with grouped courses, 1-2 sentence explanations, and signed off as the Course Intelligence Demo Team...]"
}`;

  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    const domains = [...new Set(sectionACourses.map(c => c.domain))].join(', ');
    return res.json({
      recommendedCourses: sectionACourses.map(c => ({
        ...c,
        reason: `Matches based on relevance to your query in ${c.domain}.`
      })),
      overallRecommendation: `Based on your query, we found ${sectionACourses.length} relevant courses across ${domains}. These courses range from ${[...new Set(sectionACourses.map(c => c.level))].join(' to ')} level and cover key topics aligned with your organisation\'s interests.`,
      source: 'tfidf'
    });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid Groq response format');
    const parsed = JSON.parse(jsonMatch[0]);

    // Enrich recommended courses with full data
    const enriched = parsed.recommendedCourses.map(rec => {
      const full = pool.find(c => c.name.toLowerCase() === rec.name.toLowerCase())
        || pool.find(c => c.name.toLowerCase().includes(rec.name.toLowerCase().substring(0, 20)));
      return { ...(full || {}), name: rec.name, reason: rec.reason };
    }).filter(c => c.id);

    res.json({
      recommendedCourses: enriched,
      overallRecommendation: parsed.overallRecommendation,
      source: 'groq'
    });
  } catch (err) {
    console.error('Groq error:', err.message);
    res.json({
      recommendedCourses: sectionACourses.map(c => ({ ...c, reason: `Relevant to your query in ${c.domain}.` })),
      overallRecommendation: `Found ${sectionACourses.length} courses matching your requirements.`,
      source: 'tfidf-fallback',
      warning: 'AI summary unavailable, showing keyword-matched results.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Course Intelligence demo running at http://localhost:${PORT}`);
});
