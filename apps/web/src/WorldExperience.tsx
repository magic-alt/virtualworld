import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Download, Loader2, Sparkles, X, Undo2, Save } from 'lucide-react';
import { StudioRuntime, type RuntimeMetrics } from '@virtualworld/engine';
import {
  assertScene,
  SceneHistory,
  CampaignSchema,
  type SceneSpec,
  type SceneNode,
  type SceneCommand,
} from '@virtualworld/scene-schema';
import { CampaignProgress } from '@virtualworld/interaction/campaign';
import { initialStory, type StoryState } from '@virtualworld/interaction';
import { mountExperienceControls } from '../shared/experience-controls';
import { mountMechanismControls } from '../shared/mechanism-controls';
import '../shared/experience.css';
import { api, json } from './api';
type Journey = { initial: SceneSpec; progress?: CampaignProgress };
export function WorldExperience({
  id,
  onBack,
  onEdit,
  onDirtyChange,
}: {
  id: string;
  onBack: () => void;
  onEdit: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [journey, setJourney] = useState<Journey>(),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const scene = assertScene(
        await api(`/api/projects/${encodeURIComponent(id)}`, { signal: controller.signal }),
      );
      let progress: CampaignProgress | undefined;
      if (scene.campaign) {
        const data = await api(`/api/campaigns/${scene.campaign.id}`, {
          signal: controller.signal,
        });
        progress = CampaignProgress.browser(
          CampaignSchema.parse(data.manifest),
          data.scenes.map(assertScene),
        );
      }
      if (!controller.signal.aborted)
        setJourney({ initial: progress ? progress.select(progress.current()) : scene, progress });
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [id]);
  if (!journey)
    return (
      <div className="experience-loading-page">
        <button onClick={onBack}>
          <ArrowLeft size={17} /> 返回世界
        </button>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <>
            <Loader2 className="spin" />
            <p>正在打开世界…</p>
          </>
        )}
      </div>
    );
  return (
    <Experience journey={journey} onBack={onBack} onEdit={onEdit} onDirtyChange={onDirtyChange} />
  );
}
function Experience({
  journey,
  onBack,
  onEdit,
  onDirtyChange,
}: {
  journey: Journey;
  onBack: () => void;
  onEdit: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [scene, setScene] = useState(journey.initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [story, setStory] = useState<StoryState>(initialStory),
    [dialog, setDialog] = useState<{ node: SceneNode; message: string }>(),
    [aiOpen, setAiOpen] = useState(false);
  const [prompt, setPrompt] = useState(''),
    [aiBusy, setAiBusy] = useState(false),
    [proposal, setProposal] = useState<{
      summary: string;
      commands: SceneCommand[];
      projectId: string;
      baseRevision: number;
    }>(),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState(false),
    [, refresh] = useState(0);
  const history = useRef(new SceneHistory(journey.initial)),
    savedRevision = useRef(journey.initial.revision),
    runtime = useRef<StudioRuntime | undefined>(undefined),
    controls = useRef<ReturnType<typeof mountExperienceControls> | undefined>(undefined),
    host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | undefined>(undefined),
    mounted = useRef(true),
    generation = useRef(0),
    operation = useRef(0);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const clearDialog = () => setDialog(undefined);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void api('/api/generation/capabilities', { signal: controller.signal })
      .then((c) => setConfigured(c.llm))
      .catch(() => {});
    return () => {
      mounted.current = false;
      controller.abort();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setDialog(undefined);
    request.current?.abort();
    setAiBusy(false);
    setProposal(undefined);
    let active: StudioRuntime | undefined,
      ui: ReturnType<typeof mountExperienceControls> | undefined,
      mechanismUi: ReturnType<typeof mountMechanismControls> | undefined;
    try {
      active = new StudioRuntime(host.current!, scene, {
        onError: (message) => {
          if (generation.current === version) setError(message);
        },
        onStory: (state, node) => {
          if (generation.current !== version) return;
          setStory(state);
          ui?.update(active!.getDiagnostics());
          refresh((n) => n + 1);
          if (node?.interaction) setDialog({ node, message: state.message });
        },
        onMetrics: (metrics: RuntimeMetrics) => {
          if (generation.current === version) ui?.update(metrics);
        },
      });
      runtime.current = active;
      window.virtualworld = active;
      ui = mountExperienceControls(active, {
        onCloseDialog: () => {
          setDialog(undefined);
          setAiOpen(false);
          request.current?.abort();
          setAiBusy(false);
        },
        onError: (e) => setError(String(e instanceof Error ? e.message : e)),
        onReset: journey.progress
          ? () => {
              journey.progress!.reset();
              const next = journey.progress!.select(journey.progress!.current());
              if (next.id === scene.id) {
                active!.resetProgress();
                clearDialog();
                refresh((n) => n + 1);
              } else switchChapter(next);
            }
          : undefined,
      });
      controls.current = ui;
      overlay.current!.append(ui.element);
      void active.ready
        .then(async () => {
          if (generation.current !== version) return;
          await active!.setMode(scene.mode === 'world' ? 'explore' : 'view');
          if (generation.current === version) {
            if (scene.mechanism) {
              mechanismUi = mountMechanismControls(active!);
              overlay.current!.append(mechanismUi.element);
            }
            setLoading(false);
            ui?.update(active!.getDiagnostics());
          }
        })
        .catch((e) => {
          if (generation.current === version) {
            setLoading(false);
            setError(String(e));
          }
        });
    } catch (e) {
      setLoading(false);
      setError(`无法启动 3D 画面：${String(e)}`);
    }
    return () => {
      generation.current++;
      mechanismUi?.dispose();
      ui?.dispose();
      active?.dispose();
      runtime.current = undefined;
      controls.current = undefined;
      if (window.virtualworld === active) delete window.virtualworld;
    };
  }, [scene]);
  useEffect(() => {
    controls.current?.setDialogOpen(!!dialog || aiOpen);
  }, [dialog, aiOpen, loading]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const leave = (action: () => void) => {
    if (!dirty || confirm('世界有未保存的修改，确定离开？')) action();
  };
  function switchChapter(next: SceneSpec) {
    request.current?.abort();
    history.current = new SceneHistory(next);
    savedRevision.current = next.revision;
    setDirty(false);
    setScene(next);
  }
  async function ask() {
    if (!prompt.trim() || aiBusy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const base = history.current.scene;
    setAiBusy(true);
    setError('');
    setProposal(undefined);
    try {
      const result = await api('/api/agent', {
        method: 'POST',
        ...json({ scene: base, prompt }),
        signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (
        result.projectId !== history.current.scene.id ||
        result.baseRevision !== history.current.scene.revision
      )
        throw new Error('世界已改变，请重新提出修改');
      setProposal(result);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted)
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (mounted.current && request.current === controller) setAiBusy(false);
    }
  }
  async function save() {
    const snapshot = scene,
      token = ++operation.current;
    setBusy('正在保存…');
    try {
      await api(`/api/projects/${scene.id}`, {
        method: 'PUT',
        ...json({ scene, baseRevision: savedRevision.current }),
      });
      journey.progress?.updateScene(snapshot);
      if (mounted.current && history.current.scene.id === snapshot.id) {
        savedRevision.current = Math.max(savedRevision.current, snapshot.revision);
        const newerEdits = history.current.scene.revision !== snapshot.revision;
        setDirty(newerEdits);
        setNotice(newerEdits ? '版本已保存，仍有新的未保存修改' : '世界已保存');
      }
    } catch (e) {
      if (mounted.current && history.current.scene.id === snapshot.id)
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (mounted.current && operation.current === token) setBusy('');
    }
  }
  async function exportWorld() {
    const version = generation.current,
      token = ++operation.current;
    setBusy('正在打包世界…');
    try {
      const response = await fetch('/api/export', { method: 'POST', ...json({ scene }) });
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const blob = await response.blob();
      if (!mounted.current || version !== generation.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `${scene.id}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('导出完成，解压后通过静态 HTTP 服务即可探索');
    } catch (e) {
      if (mounted.current && version === generation.current)
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (mounted.current && operation.current === token) setBusy('');
    }
  }
  return (
    <main className="world-experience" data-testid="world-experience">
      <div className="experience-canvas" ref={host} data-testid="viewport" />
      <div ref={overlay} />
      <header className="experience-header">
        <button className="experience-back" onClick={() => leave(onBack)} aria-label="返回世界首页">
          <ArrowLeft size={18} />
          <span>世界</span>
        </button>
        <div className="experience-title">
          <small>VIRTUALWORLD / {scene.mode === 'world' ? 'EXPLORE' : 'DISCOVER'}</small>
          <h1>{scene.name}</h1>
        </div>
        <div className="experience-header-actions">
          <button onClick={() => setAiOpen((v) => !v)} aria-label="用 AI 改变世界">
            <Sparkles size={17} />
            <span>继续创造</span>
          </button>
          <button onClick={() => void exportWorld()} disabled={!!busy} aria-label="导出世界">
            <Download size={17} />
          </button>
          <button onClick={() => leave(() => onEdit(scene.id))} aria-label="高级编辑">
            <ArrowUpRight size={17} />
            <span>高级编辑</span>
          </button>
        </div>
      </header>
      {journey.progress && (
        <div className="experience-chapters">
          <select
            aria-label="选择章节"
            value={scene.id}
            onChange={(e) => {
              const id = e.target.value;
              leave(() => switchChapter(journey.progress!.select(id)));
            }}
          >
            {journey.progress.status().map((chapter) => (
              <option key={chapter.id} value={chapter.id} disabled={!chapter.unlocked}>
                {chapter.completed ? '✓ ' : chapter.unlocked ? '' : '🔒 '}
                {chapter.title}
              </option>
            ))}
          </select>
          <span>
            {story.completed ? '本章完成 · 下一段旅程已解锁' : '每一次相遇，都是故事的开始。'}
          </span>
        </div>
      )}
      {loading && (
        <div className="experience-loading">
          <Loader2 className="spin" />
          <p>正在构建你的世界</p>
          <small>加载画面与互动资源…</small>
        </div>
      )}
      {dialog && (
        <section
          className="experience-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={dialog.node.interaction?.title}
        >
          <button className="close-panel" onClick={clearDialog} aria-label="关闭对话">
            <X size={18} />
          </button>
          <small>AN ENCOUNTER</small>
          <h2>{dialog.node.interaction?.title}</h2>
          <p>{dialog.message}</p>
          {dialog.node.interaction?.choices?.map((choice) => (
            <button
              className="dialog-choice"
              key={choice.label}
              onClick={() => setDialog({ ...dialog, message: choice.text })}
            >
              {choice.label}
            </button>
          ))}
          <button className="world-button" onClick={clearDialog}>
            {story.completed ? '本章已完成 · 继续探索' : '继续探索'} <ArrowUpRight size={16} />
          </button>
        </section>
      )}
      {aiOpen && (
        <aside className="experience-ai" aria-label="AI 世界创作">
          <button
            className="close-panel"
            aria-label="关闭 AI 创作"
            onClick={() => {
              request.current?.abort();
              setAiBusy(false);
              setAiOpen(false);
            }}
          >
            <X size={18} />
          </button>
          <Sparkles size={26} strokeWidth={1.2} />
          <small>KEEP IMAGINING</small>
          <h2>世界，还可以不一样。</h2>
          <p>用自然语言改变氛围、布置与故事。先看看提案，再决定是否应用。</p>
          <textarea
            aria-label="描述世界修改"
            placeholder="让这个世界的光线更温暖一些…"
            value={prompt}
            maxLength={4000}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            className="world-button"
            disabled={!configured || aiBusy || !prompt.trim()}
            onClick={() => void ask()}
          >
            {aiBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}生成修改提案
          </button>
          {!configured && <p>AI 服务尚未配置，可使用高级编辑调整世界。</p>}
          {proposal && (
            <div className="experience-proposal" data-testid="ai-proposal">
              <h3>修改提案</h3>
              <p>{proposal.summary}</p>
              <ul>
                {proposal.commands.map((command, i) => (
                  <li key={i}>
                    {command.type === 'addNode'
                      ? `添加：${command.node.name}`
                      : command.type === 'updateNode' || command.type === 'removeNode'
                        ? `调整：${scene.nodes.find((n) => n.id === command.id)?.name || command.id}`
                        : command.type === 'setEnvironment'
                          ? '调整世界氛围'
                          : '更新世界内容'}
                  </li>
                ))}
              </ul>
              <button
                className="world-button"
                onClick={() => {
                  try {
                    if (proposal.projectId !== scene.id || proposal.baseRevision !== scene.revision)
                      throw new Error('提案已过期，请重新生成');
                    setScene(history.current.apply(proposal.commands));
                    setDirty(true);
                    setProposal(undefined);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                应用提案
              </button>
              <button onClick={() => setProposal(undefined)}>放弃</button>
            </div>
          )}
          <div className="experience-ai-actions">
            <button
              disabled={!history.current.canUndo}
              onClick={() => {
                setScene(history.current.undo());
                setDirty(true);
                setProposal(undefined);
              }}
            >
              <Undo2 size={15} />
              撤销修改
            </button>
            <button aria-label="保存世界" disabled={!dirty || !!busy} onClick={() => void save()}>
              <Save size={15} />
              保存世界{dirty ? ' ·' : ''}
            </button>
          </div>
        </aside>
      )}
      {(error || busy || notice) && (
        <div
          className={`experience-message ${error ? 'error-message' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || busy || notice}
          <button
            onClick={() => {
              setError('');
              setNotice('');
            }}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
