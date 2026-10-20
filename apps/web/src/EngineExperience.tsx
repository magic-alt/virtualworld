import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, ExternalLink, RotateCcw } from 'lucide-react';
import { EngineCapabilities, type ExperienceEngine } from '../shared/engine-runtime';
import { assertScene } from '@virtualworld/scene-schema';
import { api, json, readJsonResponse } from './api';
import './engine-experience.css';

const labels = { web: '网页', unity: 'Unity', unreal: 'Unreal Engine' };
export function EngineExperience({
  id,
  onBack,
  beforeSwitch,
  activeSceneId,
  renderWeb,
}: {
  id: string;
  onBack: () => void;
  beforeSwitch: () => boolean;
  activeSceneId: () => string;
  renderWeb: (selector: ReactNode) => ReactNode;
}) {
  const [capabilities, setCapabilities] = useState<EngineCapabilities>();
  const [engine, setEngine] = useState<ExperienceEngine>('web');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  async function readCapabilities(sceneId: string, controller: AbortController) {
    const data = await api(`/api/projects/${encodeURIComponent(sceneId)}/engines`, {
      signal: controller.signal,
    });
    const parsed = EngineCapabilities.parse(data);
    if (parsed.sceneId !== sceneId) throw new Error('引擎配置与当前世界不一致');
    return parsed;
  }
  useEffect(() => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setCapabilities(undefined);
    setError('');
    void readCapabilities(id, controller)
      .then((parsed) => {
        if (controller.signal.aborted) return;
        setCapabilities(parsed);
        const requested = new URLSearchParams(location.search).get('engine');
        setEngine(
          requested === 'unity' || requested === 'unreal' || requested === 'web'
            ? requested
            : parsed.defaultEngine,
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => request.current?.abort();
  }, [id]);
  const selected = capabilities?.engines.find((entry) => entry.id === engine);

  async function choose(value: ExperienceEngine) {
    if (value === engine || !beforeSwitch()) return;
    const sceneId = engine === 'web' ? activeSceneId() : (capabilities?.sceneId ?? id);
    setError('');
    setEngine(value);
    const url = new URL(location.href);
    url.searchParams.set('engine', value);
    url.searchParams.set('project', sceneId);
    history.replaceState(history.state, '', url);
    if (value === 'web') return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    // Never mount a cached build after a save or a chapter change.
    setCapabilities(undefined);
    try {
      const parsed = await readCapabilities(sceneId, controller);
      if (!controller.signal.aborted) setCapabilities(parsed);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function downloadProject() {
    if (engine === 'web') return;
    setDownloading(true);
    setError('');
    try {
      const sceneId = capabilities?.sceneId ?? id;
      const scene = assertScene(await api(`/api/projects/${encodeURIComponent(sceneId)}`));
      const response = await fetch('/api/export', {
        method: 'POST',
        ...json({ scene, target: engine }),
      });
      if (!response.ok) await readJsonResponse(response, '/api/export');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${sceneId}-${engine}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  }
  const selector = (
    <label className="engine-selector">
      <span>渲染引擎</span>
      <select
        aria-label="渲染引擎"
        value={engine}
        onChange={(event) => void choose(event.target.value as ExperienceEngine)}
      >
        <option value="web">网页 · Three.js</option>
        <option value="unity">Unity</option>
        <option value="unreal">Unreal Engine</option>
      </select>
    </label>
  );
  if (!capabilities)
    return (
      <main className="native-engine-page">
        <button onClick={onBack}>返回世界</button>
        {error ? <p role="alert">{error}</p> : <p role="status">正在读取世界运行配置…</p>}
        {error && (
          <button
            onClick={() => {
              setCapabilities({
                sceneId: id,
                revision: 0,
                defaultEngine: 'web',
                engines: [
                  { id: 'unity', status: 'missing' },
                  { id: 'unreal', status: 'missing' },
                ],
              });
              setEngine('web');
            }}
          >
            使用网页打开
          </button>
        )}
      </main>
    );
  if (engine === 'web') return renderWeb(selector);
  const available = selected?.status === 'configured' && selected.url;
  return (
    <main className="native-engine-page" data-engine={engine}>
      <header className="native-engine-header">
        <button onClick={onBack}>
          <ArrowLeft size={18} /> 世界
        </button>
        {selector}
        <button disabled={downloading} onClick={() => void downloadProject()}>
          <Download size={17} /> {downloading ? '正在打包…' : `下载 ${labels[engine]} 包`}
        </button>
        {available && (
          <>
            <button
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
              aria-label="重新载入引擎"
            >
              <RotateCcw size={17} />
            </button>
            <a href={selected.url} target="_blank" rel="noopener noreferrer">
              独立打开 <ExternalLink size={16} />
            </a>
          </>
        )}
      </header>
      {error && (
        <p className="native-engine-error" role="alert">
          {error}
        </p>
      )}
      {available ? (
        <>
          <p className="native-engine-status" role="status">
            {labels[engine]} 入口已配置。运行状态需在引擎画面中确认；无法显示时请独立打开。
          </p>
          <iframe
            key={`${capabilities.sceneId}:${engine}:${attempt}`}
            className="native-engine-frame"
            title={`${labels[engine]} 世界运行画面`}
            src={selected.url}
            allow="autoplay; fullscreen; gamepad"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-downloads"
            onError={() => setError(`${labels[engine]} 运行页面加载失败，请检查服务后重新载入。`)}
          />
        </>
      ) : (
        <section className="native-engine-empty">
          <p className="native-engine-kicker">{labels[engine]}</p>
          <h1>{selected?.status === 'stale' ? '这个世界需要重新构建' : '原生引擎尚未连接'}</h1>
          <p>
            {selected?.status === 'stale'
              ? '已发布的引擎构建对应旧版本，请更新构建后再打开。'
              : engine === 'unity'
                ? '下载源码包并在 Unity 完成导入和构建；发布 Unity Web 后，也可以在这里体验。'
                : '下载源码包并在 Unreal 完成编译和构建；连接 Pixel Streaming 后，也可以在这里体验。'}
          </p>
          <button className="world-button dark" onClick={() => void choose('web')}>
            使用网页继续体验
          </button>
        </section>
      )}
    </main>
  );
}
