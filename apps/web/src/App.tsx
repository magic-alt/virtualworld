import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { ArrowRight, ArrowUpRight, Globe2, Sparkles } from 'lucide-react';
import { assertScene, type SceneSpec } from '@virtualworld/scene-schema';
import { Viewport } from './Viewport';
import { api } from './api';
import { WorldComposer } from './WorldComposer';
import { WorldExperience } from './WorldExperience';
import './world.css';
const StudioApp = lazy(() => import('./StudioApp'));
type Project = { id: string; name: string; mode: string; description: string; revision: number };
type Route = { project?: string; edit: boolean };
function currentRoute(): Route {
  const params = new URLSearchParams(location.search);
  return { project: params.get('project') || undefined, edit: params.get('edit') === '1' };
}
export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const dirty = useRef(false),
    routeUrl = useRef(location.href),
    routeIndex = useRef<number>(history.state?.virtualworldIndex ?? 0),
    reverting = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  useEffect(() => {
    history.replaceState(
      { ...history.state, virtualworldIndex: routeIndex.current },
      '',
      location.href,
    );
    const pop = (event: PopStateEvent) => {
      if (reverting.current) {
        reverting.current = false;
        return;
      }
      if (dirty.current && !confirm('世界有未保存的修改，确定离开？')) {
        const nextIndex = event.state?.virtualworldIndex;
        if (typeof nextIndex === 'number' && nextIndex !== routeIndex.current) {
          reverting.current = true;
          history.go(routeIndex.current - nextIndex);
        } else history.pushState({ virtualworldIndex: routeIndex.current }, '', routeUrl.current);
        return;
      }
      routeUrl.current = location.href;
      routeIndex.current = event.state?.virtualworldIndex ?? routeIndex.current;
      dirty.current = false;
      setRoute(currentRoute());
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function navigate(project?: string, edit = false) {
    const query = new URLSearchParams();
    if (project) query.set('project', project);
    if (edit) query.set('edit', '1');
    routeIndex.current++;
    history.pushState(
      { virtualworldIndex: routeIndex.current },
      '',
      query.size ? `?${query}` : location.pathname,
    );
    routeUrl.current = location.href;
    setRoute({ project, edit });
    window.scrollTo(0, 0);
  }
  if (route.edit)
    return (
      <Suspense fallback={<div className="world-loading">正在打开高级编辑…</div>}>
        <StudioApp key={route.project} onExit={() => navigate()} onDirtyChange={onDirtyChange} />
      </Suspense>
    );
  if (route.project)
    return (
      <WorldExperience
        key={route.project}
        id={route.project}
        onBack={() => navigate()}
        onEdit={(id) => navigate(id, true)}
        onDirtyChange={onDirtyChange}
      />
    );
  return <Home onOpen={(id) => navigate(id)} onEdit={() => navigate(undefined, true)} />;
}
function Home({ onOpen, onEdit }: { onOpen: (id: string) => void; onEdit: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [preview, setPreview] = useState<SceneSpec>(),
    [error, setError] = useState('');
  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/projects', { signal: controller.signal })
      .then((data) => {
        setProjects(data.projects);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [catalogVersion]);
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/projects/little-prince-desert', { signal: controller.signal })
      .then((s) => setPreview(assertScene(s)))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const chapters = new Set(['little-prince-desert', 'little-prince-b612', 'little-prince-earth']);
  const personal = projects.filter((p) => !chapters.has(p.id) && p.id !== 'demo-harmonic-joint');
  return (
    <div className="world-home">
      <header className="world-nav">
        <a href="/" className="world-brand">
          <Globe2 size={25} strokeWidth={1.4} /> virtualworld<span>AI</span>
        </a>
        <nav aria-label="主导航">
          <a href="#worlds">探索世界</a>
          <a href="#create">创造世界</a>
          <a href="#mine">我的世界</a>
        </nav>
        <a className="world-nav-cta" href="#create">
          开始创造 <ArrowUpRight size={15} />
        </a>
      </header>
      <main>
        <section className="world-hero">
          <div className="hero-copy">
            <p className="world-eyebrow">
              <span /> IMAGINATION, INHABITED
            </p>
            <h1>
              让想象，
              <br />
              <em>成为可抵达的世界。</em>
            </h1>
            <p className="hero-description">
              一句描述，一张灵感。与 AI 一起创造属于你的三维世界，
              <br className="desktop-break" />
              走进去，遇见故事，发现新的可能。
            </p>
            <a href="#create" className="world-button dark">
              创造我的世界 <ArrowUpRight size={18} />
            </a>
            <a className="hero-text-link" href="#worlds">
              先去别人的想象里走走 <ArrowRight size={16} />
            </a>
          </div>
          <div className="hero-world" aria-label="小王子世界预览">
            {preview ? (
              <Viewport
                preview
                scene={preview}
                callbacks={{}}
                onRuntime={(runtime) => {
                  void runtime.setMode('view');
                  runtime.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)')
                    .matches;
                  runtime.controls.autoRotateSpeed = 0.35;
                }}
              />
            ) : (
              <img src="/world-previews/desert.jpg" alt="小王子的沙海世界" />
            )}
            <div className="hero-world-caption">
              <div>
                <span className="world-eyebrow light">A WORLD TO WANDER</span>
                <h2>沙海中的相遇</h2>
              </div>
              <button aria-label="进入小王子世界" onClick={() => onOpen('little-prince-desert')}>
                <ArrowUpRight size={24} />
              </button>
            </div>
            <span className="hero-world-note">实时 3D · 可探索的故事</span>
          </div>
        </section>
        <section className="world-create-section" id="create">
          <div className="section-heading">
            <p className="world-eyebrow">FROM A THOUGHT TO A WORLD</p>
            <h2>你的世界，从这里开始。</h2>
            <p>描述一个地方、一种氛围，或一个想亲身走进的故事。</p>
          </div>
          <WorldComposer onOpen={onOpen} onComplete={() => setCatalogVersion((v) => v + 1)} />
        </section>
        <section className="world-gallery" id="worlds">
          <div className="section-heading horizontal">
            <div>
              <p className="world-eyebrow">WORLDS WORTH EXPLORING</p>
              <h2>进入另一个可能。</h2>
            </div>
            <p>每个世界，都有自己的故事。</p>
          </div>
          <div className="featured-worlds">
            <button
              className="world-card prince-card"
              onClick={() => onOpen('little-prince-desert')}
            >
              <div className="world-cover">
                <img src="/world-previews/desert.jpg" alt="小王子沙海场景" loading="lazy" />
                <span className="world-card-pill">故事旅程 · 三个章节</span>
                <span className="card-enter">
                  <ArrowUpRight />
                </span>
              </div>
              <div className="world-card-copy">
                <div>
                  <h3>小王子：照料与相遇</h3>
                  <p>沙海、小星球与玫瑰园。在相遇中，读懂牵挂。</p>
                </div>
                <span>探索旅程</span>
              </div>
            </button>
            <button className="world-card" onClick={() => onOpen('demo-harmonic-joint')}>
              <div className="world-cover harmonic-cover">
                <img src="/world-previews/harmonic.jpg" alt="谐波关节交互展示" loading="lazy" />
                <span className="world-card-pill">交互展示</span>
                <span className="card-enter">
                  <ArrowUpRight />
                </span>
              </div>
              <div className="world-card-copy">
                <div>
                  <h3>精密之中的宇宙</h3>
                  <p>旋转、拆解、观察。探索 H-100 谐波关节的运动之美。</p>
                </div>
                <span>进入展示</span>
              </div>
            </button>
          </div>
        </section>
        <section className="world-gallery personal-gallery" id="mine">
          <div className="section-heading horizontal">
            <div>
              <p className="world-eyebrow">YOUR OWN UNIVERSE</p>
              <h2>我的世界</h2>
            </div>
            <a href="#create">
              创造新的世界 <Sparkles size={16} />
            </a>
          </div>
          {error && (
            <p className="world-error" role="alert">
              无法读取世界库：{error}
              <button onClick={() => setCatalogVersion((v) => v + 1)}>重新连接</button>
            </p>
          )}
          {personal.length ? (
            <div className="personal-worlds">
              {personal.map((p) => (
                <button className="personal-world" key={p.id} onClick={() => onOpen(p.id)}>
                  <span className="personal-world-icon">
                    <Globe2 size={32} strokeWidth={1} />
                  </span>
                  <span>
                    <small>{p.mode === 'world' ? '可探索世界' : '交互展示'}</small>
                    <h3>{p.name}</h3>
                    <p>{p.description}</p>
                  </span>
                  <ArrowUpRight size={20} />
                </button>
              ))}
            </div>
          ) : (
            <div className="world-empty">
              <Sparkles size={24} strokeWidth={1.3} />
              <p>这里，将收藏你的想象。</p>
              <a href="#create">
                创造第一个世界 <ArrowRight size={16} />
              </a>
            </div>
          )}
        </section>
        <section className="world-closing">
          <p className="world-eyebrow">THINK BEYOND THE SCREEN</p>
          <h2>
            不止于看见。
            <br />
            <em>走进你的想象。</em>
          </h2>
          <a href="#create" className="world-button dark">
            开始创造 <ArrowUpRight size={18} />
          </a>
        </section>
      </main>
      <footer className="world-footer">
        <a className="world-brand" href="/">
          <Globe2 size={22} /> virtualworld
        </a>
        <p>由想象出发，在世界相遇。</p>
        <button onClick={onEdit}>
          高级编辑 <ArrowUpRight size={13} />
        </button>
      </footer>
    </div>
  );
}
