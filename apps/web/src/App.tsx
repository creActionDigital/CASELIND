import type { PublicOrg } from '@caselind/contracts';
import { useEffect, useState } from 'react';
import { fetchPublicOrg } from './api';
import { initialLang, messages, type Lang, type Messages } from './i18n';
import { DAYS, formatDay, parseRoute, safeHttps } from './logic';

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [path, setPath] = useState(window.location.pathname);
  const m = messages[lang];
  const go = (to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  };
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // not essential
    }
  }, [lang]);

  const route = parseRoute(path);
  return (
    <>
      <header className="bar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go('/');
          }}
        >
          <img src="/icon.svg" alt="" width="28" height="28" /> CASELIND
        </a>
        <button className="ghost" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} aria-label="Language">
          {lang === 'fr' ? 'EN' : 'FR'}
        </button>
      </header>
      <main>
        {route.name === 'home' ? <Home m={m} go={go} /> : null}
        {route.name === 'shop' ? <Shop slug={route.slug} m={m} /> : null}
        {route.name === 'notfound' ? <p>{m.notFound}</p> : null}
      </main>
    </>
  );
}

function Home({ m, go }: { m: Messages; go: (to: string) => void }) {
  const [slug, setSlug] = useState('');
  const clean = slug.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(clean);
  return (
    <section>
      <h1>{m.tagline}</h1>
      <p className="muted">{m.intro}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) go(`/s/${clean}`);
        }}
      >
        <label htmlFor="slug">{m.slugLabel}</label>
        <input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} autoCapitalize="none" autoCorrect="off" />
        <button type="submit" disabled={!valid}>
          {m.open}
        </button>
      </form>
    </section>
  );
}

type ShopState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; org: PublicOrg };

function Shop({ slug, m }: { slug: string; m: Messages }) {
  const [state, setState] = useState<ShopState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetchPublicOrg(slug)
      .then((org) => live && setState(org ? { status: 'ok', org } : { status: 'missing' }))
      .catch(() => live && setState({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [slug]);

  if (state.status === 'loading') return <p>{m.loading}</p>;
  if (state.status === 'missing') return <p>{m.shopMissing}</p>;
  if (state.status === 'error') return <p role="alert">{m.error}</p>;
  const o = state.org;
  const site = safeHttps(o.website);
  return (
    <article>
      <h1>
        {o.name} {o.verified ? <span className="badge">{m.verified}</span> : null}
      </h1>
      <p className="muted">{[o.city, o.country].filter(Boolean).join(', ')}</p>
      {o.description ? <p>{o.description}</p> : null}
      {o.address || o.phone || o.email || site ? <h2>{m.contact}</h2> : null}
      <ul>
        {o.address ? <li>{o.address}</li> : null}
        {o.phone ? <li>{o.phone}</li> : null}
        {o.email ? <li>{o.email}</li> : null}
        {site ? (
          <li>
            <a href={site} rel="noopener noreferrer nofollow" target="_blank">
              {m.website}
            </a>
          </li>
        ) : null}
      </ul>
      {o.openingHours ? (
        <>
          <h2>{m.hours}</h2>
          <table>
            <tbody>
              {DAYS.map((d, i) => (
                <tr key={d}>
                  <th scope="row">{m.days[i]}</th>
                  <td>{formatDay(o.openingHours?.[d]) ?? m.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="muted">{m.getApp}</p>
    </article>
  );
}
