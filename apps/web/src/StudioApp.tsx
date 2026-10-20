import { mountMechanismControls } from '../shared/mechanism-controls';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Orbit,
  Box,
  Globe2,
  Layers,
  FolderOpen,
  Settings2,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Eye,
  EyeOff,
  Upload,
  Undo2,
  Redo2,
  Play,
  Square,
  Download,
  Check,
  CheckCircle2,
  MousePointer2,
  Move,
  RotateCw,
  Maximize2,
  Focus,
  Grid2X2,
  PanelRightClose,
  Sparkles,
  ArrowUpRight,
  ArrowUp,
  Loader2,
  X,
  Save,
  FileBox,
  ArrowDownToLine,
  Activity,
  Command,
  Triangle,
  MessageSquare,
  Radio,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Expand,
  ShieldCheck,
  Camera,
} from 'lucide-react';
import { node as makeNode } from '@virtualworld/scene-builder';
import {
  SceneHistory,
  applyCommands,
  emptyScene,
  type SceneCommand,
} from '@virtualworld/scene-schema';
import {
  validateScene,
  CampaignSchema,
  assertScene,
  type CampaignSpec,
  type SceneSpec,
  type SceneNode,
} from '@virtualworld/scene-schema';
import type { StudioRuntime, RuntimeMetrics } from '@virtualworld/engine';
import { initialStory, type StoryState } from '@virtualworld/interaction';
import { CampaignProgress } from '@virtualworld/interaction/campaign';
import { Viewport } from './Viewport';
import { Inspector } from './Inspector';
import { importFile } from './import';
import { ProjectScope } from './operations';
import { api, json, readJsonResponse } from './api';
type Project = { id: string; name: string; mode: string; description: string; revision: number };
type Proposal = {
  summary: string;
  commands: SceneCommand[];
  baseRevision: number;
  projectId: string;
};
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function StudioApp({
  onExit,
  onDirtyChange,
}: {
  onExit?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [scene, setScene] = useState<SceneSpec>(() => emptyScene()),
    history = useRef(new SceneHistory(scene)),
    runtime = useRef<StudioRuntime | null>(null);
  const [mechanismRuntime, setMechanismRuntime] = useState<StudioRuntime | null>(null);
  const [graphicsBlocked, setGraphicsBlocked] = useState(false);
  const mechanismHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mechanismRuntime || !scene.mechanism || !mechanismHost.current) return;
    const panel = mountMechanismControls(mechanismRuntime, { embedded: true });
    mechanismHost.current.append(panel.element);
    return () => panel.dispose();
  }, [mechanismRuntime, scene.mechanism]);
  const scope = useRef(new ProjectScope(scene.id)),
    projectRequest = useRef(0),
    focusAfterLoad = useRef<string | undefined>(undefined);
  const resumeAfterLoad = useRef<string | undefined>(undefined);
  const [campaign, setCampaign] = useState<{ manifest: CampaignSpec; scenes: SceneSpec[] }>();
  const campaignProgress = campaign
    ? CampaignProgress.browser(
        campaign.manifest,
        campaign.scenes.map((s) => (s.id === scene.id ? scene : s)),
      )
    : undefined;
  const [unsavedProject, setUnsavedProject] = useState(false);
  const [selected, setSelected] = useState<string | undefined>('housing'),
    [savedRevision, setSavedRevision] = useState(0),
    [projects, setProjects] = useState<Project[]>([]),
    [projectMenu, setProjectMenu] = useState(false),
    [showAdd, setShowAdd] = useState(false),
    [newProject, setNewProject] = useState(false),
    [newName, setNewName] = useState('我的新场景'),
    [newMode, setNewMode] = useState<'industrial' | 'world'>('industrial');
  const [leftTab, setLeftTab] = useState<'scene' | 'assets'>('scene'),
    [rightTab, setRightTab] = useState<'properties' | 'ai'>('properties'),
    [search, setSearch] = useState(''),
    [collapsed, setCollapsed] = useState(new Set<string>());
  const [exportTarget, setExportTarget] = useState<'web' | 'unity' | 'godot'>('web');
  const [playing, setPlaying] = useState(false),
    [explosion, setExplosion] = useState(0),
    [moving, setMoving] = useState(false),
    [tool, setTool] = useState<'translate' | 'rotate' | 'scale'>('translate'),
    [isolated, setIsolated] = useState(false);
  const [metrics, setMetrics] = useState<RuntimeMetrics>(),
    [story, setStory] = useState<StoryState>(initialStory),
    [dialog, setDialog] = useState<{ node: SceneNode; message: string } | null>(null),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(''),
    [help, setHelp] = useState(false),
    [validation, setValidation] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false),
    [prompt, setPrompt] = useState(''),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [aiBusy, setAiBusy] = useState(false),
    [aiError, setAiError] = useState('');
  const aiAbort = useRef<AbortController | null>(null),
    importAbort = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    [pending, setPending] = useState<(() => void) | null>(null);
  const current = scene.nodes.find((n) => n.id === selected),
    dirty = unsavedProject || scene.revision !== savedRevision;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const orderedNodes: SceneNode[] = [];
  const children = new Map<string | undefined, SceneNode[]>();
  for (const n of scene.nodes) {
    const siblings = children.get(n.parentId) || [];
    siblings.push(n);
    children.set(n.parentId, siblings);
  }
  function appendChildren(parent?: string) {
    for (const n of children.get(parent) || []) {
      orderedNodes.push(n);
      appendChildren(n.id);
    }
  }
  appendChildren();
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refreshProjects = useCallback(() => {
    void api('/api/projects')
      .then((data) => {
        setProjects(data.projects);
        setAiConfigured(data.aiConfigured);
      })
      .catch(() => notify('本地服务未连接，请运行 npm run dev'));
  }, [notify]);
  useEffect(() => {
    refreshProjects();
    const request = ++projectRequest.current;
    const initialId = new URLSearchParams(location.search).get('project') || 'demo-harmonic-joint';
    void api(`/api/projects/${encodeURIComponent(initialId)}`)
      .then((s) => {
        if (request !== projectRequest.current || history.current.scene.revision !== 0) return;
        setProject(assertScene(s));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    setCampaign(undefined);
    if (scene.campaign)
      void api(`/api/campaigns/${scene.campaign.id}`)
        .then((data) => {
          if (!cancelled)
            setCampaign({
              manifest: CampaignSchema.parse(data.manifest),
              scenes: data.scenes.map(assertScene),
            });
        })
        .catch((e) => {
          if (!cancelled) notify(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [scene.id, scene.campaign?.id]);
  const commit = useCallback(
    (commands: SceneCommand[]) => {
      try {
        const next = history.current.apply(commands);
        setScene(next);
        setProposal(null);
      } catch (error) {
        notify(String(error instanceof Error ? error.message : error));
      }
    },
    [notify],
  );
  const change = (patch: Partial<SceneNode>) => {
    if (selected) commit([{ type: 'updateNode', id: selected, patch }]);
  };
  async function save() {
    const token = scope.current.capture();
    setBusy('保存项目…');
    try {
      await api(`/api/projects/${scene.id}`, {
        method: 'PUT',
        ...json({ scene, baseRevision: savedRevision }),
      });
      if (scope.current.isCurrent(token)) {
        setSavedRevision(scene.revision);
        setUnsavedProject(false);
      }
      refreshProjects();
      notify('项目已保存到本地');
      return true;
    } catch (error) {
      notify(String(error instanceof Error ? error.message : error));
      return false;
    } finally {
      setBusy('');
    }
  }
  function undo() {
    setScene(history.current.undo());
    setProposal(null);
  }
  function redo() {
    setScene(history.current.redo());
    setProposal(null);
  }
  function setProject(next: SceneSpec) {
    resumeAfterLoad.current = undefined;
    projectRequest.current++;
    scope.current.switchTo(next.id);
    aiAbort.current?.abort();
    importAbort.current?.abort();
    setAiBusy(false);
    setAiError('');
    focusAfterLoad.current = undefined;
    setUnsavedProject(false);
    runtime.current?.stop();
    history.current = new SceneHistory(next);
    setScene(next);
    setSavedRevision(next.revision);
    setSelected(next.nodes.find((n) => n.id === 'housing')?.id);
    setPlaying(false);
    setMoving(false);
    setExplosion(0);
    setIsolated(false);
    setProposal(null);
    setDialog(null);
    setProjectMenu(false);
    setStory(initialStory());
  }
  async function openProject(id: string) {
    const action = () => {
      const request = ++projectRequest.current;
      void api(`/api/projects/${id}`)
        .then((next) => {
          if (request === projectRequest.current) setProject(next);
        })
        .catch((e) => notify(e.message));
    };
    if (dirty) {
      setPending(() => action);
      setProjectMenu(false);
    } else action();
  }
  function openChapter(id: string) {
    if (!campaignProgress) return;
    try {
      if (!campaignProgress.status().some((chapter) => chapter.id === id && chapter.unlocked))
        throw new Error('章节尚未解锁');
      const active = playing;
      const action = () => {
        const request = ++projectRequest.current;
        void api(`/api/projects/${id}`)
          .then((next) => {
            if (request !== projectRequest.current) return;
            campaignProgress.select(id);
            setProject(assertScene(next));
            resumeAfterLoad.current = active ? id : undefined;
          })
          .catch((e) => notify(e.message));
      };
      if (dirty) setPending(() => action);
      else action();
    } catch (e) {
      notify(String(e));
    }
  }
  function openCampaign(id: string) {
    const action = () => {
      const request = ++projectRequest.current;
      void api(`/api/campaigns/${id}`)
        .then((data) => {
          if (request !== projectRequest.current) return;
          const manifest = CampaignSchema.parse(data.manifest),
            scenes = data.scenes.map(assertScene);
          const progress = CampaignProgress.browser(manifest, scenes);
          setProject(progress.select(progress.current()));
        })
        .catch((e) => notify(e.message));
    };
    if (dirty) setPending(() => action);
    else action();
  }
  function createProject() {
    const base = emptyScene(newMode);
    const next: SceneSpec = {
      ...base,
      id: `project-${crypto.randomUUID().slice(0, 12)}`,
      name: newName.trim() || '未命名项目',
      description: '',
      nodes: [],
      assets: [],
      tasks: [],
      revision: 0,
    };
    const action = () => {
      setProject(next);
      setUnsavedProject(true);
      setNewProject(false);
    };
    if (dirty) setPending(() => action);
    else action();
  }
  async function startPlay() {
    setPlaying(true);
    setDialog(null);
    setExplosion(0);
    setMoving(false);
    setStory(initialStory());
    try {
      await runtime.current?.play();
    } catch (e) {
      notify(String(e));
      setPlaying(false);
    }
  }
  function stopPlay() {
    runtime.current?.stop();
    setPlaying(false);
    setDialog(null);
    setStory(initialStory());
    runtime.current?.select(selected);
  }
  useEffect(() => {
    if (!scene.mechanism) runtime.current?.explode(explosion);
  }, [explosion, !!scene.mechanism]);
  useEffect(() => {
    if (!scene.mechanism) runtime.current?.animateJoints(moving);
  }, [moving, !!scene.mechanism]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (event.target as HTMLElement).tagName,
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
      if (
        !editing &&
        !playing &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if (event.key === 'Escape') {
        if (playing) stopPlay();
        setDialog(null);
        setHelp(false);
        setProjectMenu(false);
      }
    };
    window.addEventListener('keydown', keys);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('keydown', keys);
      window.removeEventListener('beforeunload', unload);
    };
  }, [scene, savedRevision, playing, dirty]);
  async function importModel(file: File) {
    const controller = new AbortController();
    const token = scope.current.capture();
    importAbort.current?.abort();
    importAbort.current = controller;
    try {
      setBusy('准备导入…');
      let commands = await importFile(file, controller.signal, (message) => {
        if (scope.current.isCurrent(token)) setBusy(message);
      });
      if (controller.signal.aborted || !scope.current.isCurrent(token)) return;
      const known = new Set(history.current.scene.assets.map((a) => a.id));
      commands = commands.filter((c) => c.type !== 'addAsset' || !known.has(c.asset.id));
      applyCommands(history.current.scene, history.current.scene.revision, commands);
      const first = commands.find((c) => c.type === 'addNode');
      if (first?.type === 'addNode') focusAfterLoad.current = first.node.id;
      commit(commands);
      if (first?.type === 'addNode') setSelected(first.node.id);
      setLeftTab('scene');
      notify(`已导入 ${file.name}，模型坐标统一为米`);
    } catch (e) {
      if (scope.current.isCurrent(token)) notify(e instanceof Error ? e.message : String(e));
    } finally {
      if (importAbort.current === controller) {
        setBusy('');
        importAbort.current = null;
      }
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function validate() {
    setBusy('验证场景…');
    try {
      const errors = validateScene(scene);
      if (errors.length) throw new Error(errors.join('\n'));
      await api('/api/validate', { method: 'POST', ...json({ scene }) });
      if (metrics?.loading) throw new Error('资源仍在加载，请稍后重试');
      if (metrics?.errors.length) throw new Error(metrics.errors.join('\n'));
      setValidation(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  async function exportPage() {
    const label = exportTarget === 'web' ? '网页' : exportTarget === 'unity' ? 'Unity' : 'Godot';
    setBusy(`验证并打包${label}…`);
    try {
      if (metrics?.loading) throw new Error('资源仍在加载，请稍后重试');
      if (metrics?.errors.length) throw new Error(metrics.errors.join('\n'));
      const response = await fetch('/api/export', {
        method: 'POST',
        ...json({ scene, target: exportTarget }),
      });
      if (!response.ok) await readJsonResponse(response, '/api/export');
      download(
        await response.blob(),
        `${scene.name}${exportTarget === 'web' ? '' : `-${exportTarget}`}.zip`,
      );
      notify(
        exportTarget === 'web'
          ? '网页已导出，解压后使用静态服务器打开'
          : `${label} 已导出，请先阅读 compatibility.json 兼容性报告`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  async function askAgent() {
    if (!prompt.trim()) return;
    setAiBusy(true);
    setAiError('');
    setProposal(null);
    const controller = new AbortController();
    const token = scope.current.capture();
    aiAbort.current?.abort();
    aiAbort.current = controller;
    try {
      const result = await api('/api/agent', {
        method: 'POST',
        ...json({ scene, prompt, selectedId: selected }),
        signal: controller.signal,
      });
      if (!scope.current.isCurrent(token)) return;
      if (
        result.projectId !== history.current.scene.id ||
        result.baseRevision !== history.current.scene.revision
      )
        throw new Error('场景已经改变，请基于当前版本重新生成提案');
      setProposal(result);
    } catch (e) {
      if (scope.current.isCurrent(token))
        setAiError(
          controller.signal.aborted
            ? '请求已取消，场景未改变'
            : e instanceof Error
              ? e.message
              : String(e),
        );
    } finally {
      if (aiAbort.current === controller) {
        setAiBusy(false);
        aiAbort.current = null;
      }
    }
  }
  function addPrimitive(shape: SceneNode['shape']) {
    const id = `object-${crypto.randomUUID().slice(0, 8)}`;
    commit([
      {
        type: 'addNode',
        node: makeNode(
          id,
          (
            {
              box: '立方体',
              sphere: '球体',
              cylinder: '圆柱',
              tree: '星杉',
              crystal: '晶石',
              character: '角色',
            } as any
          )[shape!] || '对象',
          shape,
          [0, 1, 0],
          [1, 1, 1],
          '#b9c5d6',
        ),
      },
    ]);
    setSelected(id);
    setShowAdd(false);
  }
  const nodeHidden = (n: SceneNode) => {
    let parent = n.parentId;
    while (parent) {
      if (collapsed.has(parent)) return true;
      parent = scene.nodes.find((n) => n.id === parent)?.parentId;
    }
    return false;
  };
  const depth = (n: SceneNode) => {
    let count = 0,
      parent = n.parentId;
    while (parent && count < 20) {
      count++;
      parent = scene.nodes.find((n) => n.id === parent)?.parentId;
    }
    return count;
  };
  const describeCommand = (c: SceneCommand) => {
    if (c.type === 'addNode') return `添加「${c.node.name}」`;
    if (c.type === 'removeNode')
      return `删除「${scene.nodes.find((n) => n.id === c.id)?.name || c.id}」及子对象`;
    if (c.type === 'updateNode') {
      const props: Record<string, string> = {
        color: '颜色',
        position: '位置',
        rotation: '旋转',
        scale: '缩放',
        name: '名称',
        interaction: '交互',
        joint: '关节',
        collider: '碰撞',
        materialOverride: '外观',
        size: '尺寸',
        explode: '爆炸方向',
      };
      return `修改「${scene.nodes.find((n) => n.id === c.id)?.name || c.id}」：${Object.keys(
        c.patch,
      )
        .filter((k) => k !== 'materialOverride')
        .map((k) => props[k] || k)
        .join('、')}`;
    }
    return c.type === 'setEnvironment'
      ? '调整场景环境'
      : c.type === 'renameProject'
        ? `重命名为「${c.name}」`
        : c.type === 'configureScene'
          ? '更新默认镜头、出生点或任务手记'
          : '添加资源';
  };
  return (
    <div className={`studio ${playing ? 'is-playing' : ''}`}>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (!dirty || confirm('存在未保存修改，确定返回世界首页？')) onExit?.();
          }}
        >
          <span className="brand-mark">
            <Orbit size={24} />
          </span>
          virtualworld<span className="brand-studio">STUDIO</span>
        </a>
        <div className="header-divider" />
        <span className="workspace-label">我的工作空间</span>
        <ChevronRight size={14} className="muted" />
        <div className="project-picker">
          <button
            className="project-title"
            aria-label="切换项目"
            onClick={() => {
              if (!projectMenu) refreshProjects();
              setProjectMenu(!projectMenu);
            }}
          >
            {scene.name}
            <ChevronDown size={13} />
          </button>
          {projectMenu && (
            <div className="project-menu">
              <div className="menu-label">本地项目</div>
              {projects.map((p) => (
                <button key={p.id} onClick={() => void openProject(p.id)}>
                  {p.mode === 'world' ? <Globe2 size={17} /> : <Box size={17} />}
                  <span>
                    {p.name}
                    <small>
                      {p.mode === 'world' ? '交互世界' : '工业展示'} · r{p.revision}
                    </small>
                  </span>
                  {p.id === scene.id && <Check size={14} />}
                </button>
              ))}
              <button
                className="new-project-menu"
                onClick={() => {
                  setProjectMenu(false);
                  setNewProject(true);
                }}
              >
                <Plus size={15} />
                新建项目
              </button>
            </div>
          )}
        </div>
        <span className={`save-status ${dirty ? 'dirty' : ''}`}>
          <span />
          {dirty ? '有未保存的修改' : '已保存到本地'}
        </span>
        <div className="header-spacer" />
        <button
          className="icon-button"
          aria-label="保存项目"
          title="保存项目 Ctrl+S"
          onClick={() => void save()}
          disabled={!!busy}
        >
          <Save size={17} />
        </button>
        <button className="top-button" onClick={() => void validate()}>
          <CheckCircle2 size={15} />
          验证
        </button>
        <button
          className="top-button preview-button"
          onClick={() => (playing ? stopPlay() : void startPlay())}
        >
          {playing ? <Square size={14} /> : <Play size={14} />} {playing ? '退出体验' : '体验'}
        </button>
        <select
          aria-label="导出目标"
          className="export-target"
          value={exportTarget}
          onChange={(event) => setExportTarget(event.target.value as 'web' | 'unity' | 'godot')}
          disabled={!!busy}
        >
          <option value="web">网页</option>
          <option value="unity">Unity 6</option>
          <option value="godot">Godot 4</option>
        </select>
        <button className="export-button" onClick={() => void exportPage()} disabled={!!busy}>
          <Upload size={15} />
          {exportTarget === 'web'
            ? '导出网页'
            : exportTarget === 'unity'
              ? '导出 Unity'
              : '导出 Godot'}
          <ArrowUpRight size={14} />
        </button>
        <div className="avatar" title="本地工作空间">
          VW
        </div>
      </header>
      <div className="workbench">
        <nav className="activity-rail" aria-label="工作区导航">
          <button
            className="rail-button active"
            title="场景工作室"
            onClick={() => setLeftTab('scene')}
          >
            <Layers size={21} />
          </button>
          <button
            className={`rail-button ${scene.mode === 'industrial' ? 'current' : ''}`}
            aria-label="切换到工业展示"
            title="H-100 谐波关节"
            onClick={() => void openProject('demo-harmonic-joint')}
          >
            <Box size={21} />
          </button>
          <button
            className={`rail-button ${scene.mode === 'world' ? 'current' : ''}`}
            aria-label="切换到故事世界"
            title="小王子三章"
            onClick={() => openCampaign('little-prince')}
          >
            <Globe2 size={21} />
          </button>
          <span className="rail-separator" />
          <button className="rail-button" title="资源库" onClick={() => setLeftTab('assets')}>
            <FolderOpen size={21} />
          </button>
          <button className="rail-button" title="AI 助手" onClick={() => setRightTab('ai')}>
            <Sparkles size={21} />
          </button>
          <div className="rail-bottom">
            <button
              className="rail-button"
              title="环境设置"
              onClick={() => {
                setSelected(undefined);
                setRightTab('properties');
              }}
            >
              <Settings2 size={19} />
            </button>
            <button
              className="rail-button"
              aria-label="使用帮助"
              title="帮助"
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={19} />
            </button>
            <div className="rail-profile">V</div>
          </div>
        </nav>
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={leftTab === 'scene' ? 'active' : ''}
              onClick={() => setLeftTab('scene')}
            >
              场景<span>{scene.nodes.length}</span>
            </button>
            <button
              className={leftTab === 'assets' ? 'active' : ''}
              onClick={() => setLeftTab('assets')}
            >
              资源
            </button>
            <button className="tab-more" aria-label="新建项目" onClick={() => setNewProject(true)}>
              <Plus size={16} />
            </button>
          </div>
          {leftTab === 'scene' ? (
            <>
              <div className="scene-search">
                <Search size={14} />
                <input
                  aria-label="搜索对象"
                  placeholder="搜索场景中的对象…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>⌘ K</kbd>
              </div>
              <div className="scene-root">
                <ChevronDown size={13} />
                {scene.mode === 'world' ? <Globe2 size={15} /> : <Layers size={15} />}
                <span>{scene.name}</span>
                <small>场景</small>
              </div>
              <div className="scene-tree">
                {orderedNodes
                  .filter(
                    (n) =>
                      !nodeHidden(n) &&
                      (!search || n.name.toLowerCase().includes(search.toLowerCase())),
                  )
                  .map((n) => (
                    <div
                      key={n.id}
                      className={`tree-row ${selected === n.id ? 'selected' : ''}`}
                      style={{ paddingLeft: 14 + depth(n) * 14 }}
                    >
                      <button
                        className="tree-expand"
                        aria-label={`展开 ${n.name}`}
                        onClick={() =>
                          setCollapsed((old) => {
                            const next = new Set(old);
                            next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                            return next;
                          })
                        }
                      >
                        {scene.nodes.some((child) => child.parentId === n.id) ? (
                          collapsed.has(n.id) ? (
                            <ChevronRight size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )
                        ) : (
                          <span />
                        )}
                      </button>
                      <button
                        className="tree-name"
                        aria-label={`选择 ${n.name}`}
                        onClick={() => {
                          setSelected(n.id);
                          setRightTab('properties');
                        }}
                      >
                        {n.kind === 'splat' ? (
                          <Radio size={14} />
                        ) : n.kind === 'group' ? (
                          <FolderOpen size={14} />
                        ) : (
                          <Box size={14} />
                        )}
                        <span>{n.name}</span>
                        {n.interaction && <MessageSquare size={10} className="interaction-mark" />}
                      </button>
                      <button
                        className="tree-eye"
                        aria-label={`${n.visible ? '隐藏' : '显示'} ${n.name}`}
                        onClick={() =>
                          commit([{ type: 'updateNode', id: n.id, patch: { visible: !n.visible } }])
                        }
                      >
                        {n.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                    </div>
                  ))}
              </div>
              <div className="sidebar-bottom">
                <button className="add-object" onClick={() => setShowAdd(!showAdd)}>
                  <Plus size={15} />
                  添加对象
                  <ChevronDown size={13} />
                </button>
                {showAdd && (
                  <div className="add-menu">
                    {(['box', 'sphere', 'cylinder', 'tree', 'crystal', 'character'] as const).map(
                      (shape, i) => (
                        <button key={shape} onClick={() => addPrimitive(shape)}>
                          <Box size={14} />
                          {['立方体', '球体', '圆柱', '星杉', '晶石', '角色'][i]}
                        </button>
                      ),
                    )}
                  </div>
                )}
                <button className="import-button" onClick={() => fileInput.current?.click()}>
                  <ArrowDownToLine size={14} />
                  导入模型<span>GLB / STEP / 3DGS</span>
                </button>
              </div>
            </>
          ) : (
            <div className="asset-panel">
              <div className="asset-intro">
                <FileBox size={25} />
                <h3>项目资源</h3>
                <p>本地处理，随项目一同交付。</p>
              </div>
              <button className="add-object" onClick={() => fileInput.current?.click()}>
                <Upload size={14} />
                导入资源
              </button>
              {scene.assets.map((a) => (
                <div className="asset-card" key={a.id}>
                  <div>{a.type === 'splat' ? <Radio size={23} /> : <Box size={23} />}</div>
                  <span>
                    {a.name}
                    <small>
                      {a.type.toUpperCase()} ·{' '}
                      {a.bytes ? (a.bytes / 1024).toFixed(1) + ' KB' : '内置资源'}
                    </small>
                  </span>
                </div>
              ))}
              {!scene.assets.length && (
                <p className="empty-assets">
                  当前场景使用原生参数化几何。
                  <br />
                  导入后，模型将在这里出现。
                </p>
              )}
              <a className="sample-download" href="/fixtures/cube-mm.step" download>
                <Download size={13} />
                下载 STEP 测试件（10 mm）
              </a>
              <div className="asset-note">
                STEP 转换保留可用的名称、层级与颜色。运动参数需要人工确认。
              </div>
            </div>
          )}
        </aside>
        <main className="stage">
          <div className="stage-toolbar">
            <div className="scene-label">
              <span className="live-dot" />
              {scene.mode === 'industrial' ? '产品展示' : '交互世界'}
              <span className="toolbar-separator" />
              <span className="muted">透视视图</span>
              {campaignProgress && (
                <select
                  aria-label="故事章节"
                  value={scene.id}
                  onChange={(e) => openChapter(e.target.value)}
                >
                  {campaignProgress.status().map((chapter) => (
                    <option key={chapter.id} value={chapter.id} disabled={!chapter.unlocked}>
                      {chapter.completed ? '✓ ' : ''}
                      {chapter.title}
                      {!chapter.unlocked ? ' · 未解锁' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="stage-toolbar-right" inert={graphicsBlocked}>
              {scene.mode === 'industrial' && !scene.mechanism && !playing && (
                <>
                  <span className="explode-label">展开</span>
                  <input
                    aria-label="爆炸展开"
                    className="explode-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={explosion}
                    onChange={(e) => setExplosion(Number(e.target.value))}
                  />
                  <button
                    className={`motion-button ${moving ? 'on' : ''}`}
                    onClick={() => setMoving(!moving)}
                  >
                    <RotateCw size={13} />
                    {moving ? '停止运动' : '运动演示'}
                  </button>
                </>
              )}
              <button
                className="icon-button small"
                aria-label="重置相机"
                title="重置视角"
                onClick={() => runtime.current?.resetCamera()}
              >
                <Focus size={15} />
              </button>
              <button
                className="icon-button small"
                aria-label="设为默认视角"
                title="设为默认视角"
                onClick={() => {
                  const r = runtime.current;
                  if (r)
                    commit([
                      {
                        type: 'configureScene',
                        patch: {
                          camera: {
                            position: r.camera.position.toArray() as [number, number, number],
                            target: r.controls.target.toArray() as [number, number, number],
                          },
                        },
                      },
                    ]);
                }}
              >
                <Camera size={15} />
              </button>
              <button
                className="icon-button small"
                aria-label="截图"
                title="截图"
                onClick={() => {
                  try {
                    const data = runtime.current?.screenshot();
                    if (data) {
                      const a = document.createElement('a');
                      a.href = data;
                      a.download = `${scene.name}.png`;
                      a.click();
                    }
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
          <div className="viewport-shell">
            <div ref={mechanismHost} />
            <Viewport
              scene={scene}
              selected={selected}
              onRuntime={(r) => {
                runtime.current = r ?? null;
                setMechanismRuntime(r ?? null);
              }}
              onGraphics={(state) => setGraphicsBlocked(state.status !== 'ready')}
              callbacks={{
                onSelect: setSelected,
                onReady: () => {
                  if (resumeAfterLoad.current === scene.id) {
                    resumeAfterLoad.current = undefined;
                    void startPlay();
                  }
                  const id = focusAfterLoad.current;
                  if (id) {
                    focusAfterLoad.current = undefined;
                    runtime.current?.focus(id);
                  }
                },
                onTransform: (id, patch) => commit([{ type: 'updateNode', id, patch }]),
                onMetrics: setMetrics,
                onError: notify,
                onStory: (s, n) => {
                  setStory(s);
                  if (n) setDialog({ node: n, message: s.message });
                },
              }}
            />
            <div className="hotspot-layer">
              {!graphicsBlocked &&
                (scene.mode === 'world' || playing) &&
                metrics?.hotspots
                  ?.filter((h) => scene.nodes.some((n) => n.id === h.id))
                  .map((h) => (
                    <button
                      key={h.id}
                      className={`hotspot-label ${playing ? 'playing' : ''}`}
                      style={{ left: h.x, top: h.y }}
                      disabled={playing && scene.mode === 'world' && !h.inRange}
                      onClick={() => {
                        if (playing) runtime.current?.interact(h.id);
                        else {
                          setSelected(h.id);
                          setRightTab('properties');
                        }
                      }}
                    >
                      <span />
                      {h.label}
                      {playing && h.inRange && <kbd>E</kbd>}
                    </button>
                  ))}
            </div>
            {!playing && (
              <>
                <div className="view-heading">
                  <div className="view-tag">
                    {scene.mode === 'industrial' ? 'INDUSTRIAL SHOWCASE' : 'INTERACTIVE WORLD'}
                    <span>01</span>
                  </div>
                  <h1>
                    {scene.campaign || scene.mechanism
                      ? scene.name
                      : scene.mode === 'industrial'
                        ? '精密之中，自有秩序。'
                        : '每一束星光，都有回信。'}
                  </h1>
                  <p>{scene.description}</p>
                </div>
                <div className="viewport-tools">
                  <button className="selected-tool" title="选择对象">
                    <MousePointer2 size={17} />
                  </button>
                  <span />
                  {(
                    [
                      { id: 'translate', icon: Move, label: '移动' },
                      { id: 'rotate', icon: RotateCw, label: '旋转' },
                      { id: 'scale', icon: Expand, label: '缩放' },
                    ] as const
                  ).map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      className={tool === id ? 'selected-tool' : ''}
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        setTool(id);
                        runtime.current?.setTransformMode(id);
                      }}
                    >
                      <Icon size={17} />
                    </button>
                  ))}
                </div>
                <div className="viewport-bottom-left">
                  <span className="renderer-badge">
                    <span />
                    WEBGL 2
                  </span>
                  <span>拖动旋转 · 滚轮缩放 · 右键平移</span>
                </div>
                <div className="axis-gizmo">
                  <span className="gizmo-y">Y</span>
                  <span className="gizmo-z">Z</span>
                  <span className="gizmo-x">X</span>
                  <i />
                  <b />
                </div>
                <div className="viewport-project-tag">
                  {scene.id === 'demo-harmonic-joint'
                    ? 'H—100'
                    : scene.campaign
                      ? `LP—${String(scene.campaign.index + 1).padStart(2, '0')}`
                      : '3D'}
                  <small>
                    {scene.mode === 'industrial'
                      ? 'PRECISION SERIES'
                      : scene.campaign
                        ? 'THE LITTLE PRINCE'
                        : 'INTERACTIVE WORLD'}
                  </small>
                </div>
              </>
            )}
            {playing && (
              <>
                <div className="play-title">
                  <span className="eyebrow">VIRTUALWORLD EXPERIENCE</span>
                  <h2>{scene.name}</h2>
                  <p>
                    {scene.campaign
                      ? scene.description
                      : scene.mode === 'world'
                        ? '一封信，一段等待你完成的旅程。'
                        : '点击零件，探索产品细节。'}
                  </p>
                </div>
                {scene.mode === 'world' && (
                  <div className="quest-panel">
                    <span className="eyebrow">旅程手记</span>
                    <h3>{scene.campaign ? scene.name : '让星光抵达远方'}</h3>
                    {scene.tasks.map((t, i) => (
                      <div key={t.flag} className={story.flags.includes(t.flag) ? 'done' : ''}>
                        <span>
                          {story.flags.includes(t.flag) ? (
                            <Check size={12} />
                          ) : (
                            String(i + 1).padStart(2, '0')
                          )}
                        </span>
                        {t.label}
                      </div>
                    ))}
                    {story.completed && (
                      <p className="quest-complete">
                        {scene.campaign
                          ? '本章完成，可从上方切换下一章。'
                          : '信已寄出。谢谢你的陪伴。'}
                      </p>
                    )}
                    {campaignProgress && (
                      <button
                        onClick={() => {
                          campaignProgress.reset();
                          runtime.current?.resetProgress();
                          setDialog(null);
                          if (scene.id !== campaign!.manifest.chapters[0].id)
                            openChapter(campaign!.manifest.chapters[0].id);
                        }}
                      >
                        重置三章进度
                      </button>
                    )}
                    <button
                      onClick={() => {
                        runtime.current?.resetProgress();
                        setDialog(null);
                      }}
                    >
                      重置旅程
                    </button>
                  </div>
                )}
                <div className="play-hint">
                  {scene.mode === 'world' ? (
                    <>
                      <kbd>W A S D</kbd>移动<kbd>SPACE</kbd>跳跃
                      <button onClick={() => runtime.current?.interact()}>
                        <kbd>E</kbd>附近互动
                      </button>
                      <span>拖动调整镜头</span>
                    </>
                  ) : (
                    <>
                      <span>自由旋转 · 点击零件查看说明</span>
                      {!scene.mechanism && (
                        <>
                          <button onClick={() => setMoving(!moving)}>
                            <Play size={12} />
                            运动演示
                          </button>
                          <label>
                            爆炸图
                            <input
                              aria-label="体验爆炸展开"
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={explosion}
                              onChange={(e) => setExplosion(Number(e.target.value))}
                            />
                          </label>
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            {metrics?.loading && (
              <div className="viewport-loading">
                <Loader2 size={15} className="spin" />
                正在加载场景资源…
              </div>
            )}
            {dialog && (
              <div
                className="story-dialog"
                role="dialog"
                aria-label={dialog.node.interaction?.title}
              >
                <button
                  className="dialog-close"
                  aria-label="关闭对话"
                  onClick={() => setDialog(null)}
                >
                  <X size={15} />
                </button>
                <span className="eyebrow">
                  {scene.mode === 'world' ? 'STORY MOMENT' : 'PRODUCT DETAIL'}
                </span>
                <h3>{dialog.node.interaction?.title}</h3>
                <p>{dialog.message}</p>
                {dialog.node.interaction?.choices?.map((choice) => (
                  <button
                    className="dialog-choice"
                    key={choice.label}
                    onClick={() => setDialog({ ...dialog, message: choice.text })}
                  >
                    {choice.label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
                <button className="dialog-continue" onClick={() => setDialog(null)}>
                  {story.completed ? '继续探索' : '知道了'}
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </div>
          <div className="stage-footer">
            <div>
              <span className="status-green" />
              {metrics?.loading ? '加载中' : '场景就绪'}
              <span className="footer-divider" />
              {scene.nodes.length} 个对象
              <span className="footer-divider" />
              {metrics?.triangles ? `${(metrics.triangles / 1000).toFixed(1)}k 三角面` : '原生几何'}
            </div>
            <div>
              {metrics?.splats ? `${metrics.splats.toLocaleString()} splats · ` : ''}
              <Activity size={12} />
              <span data-testid="fps">{metrics?.fps || '—'} FPS</span>
              <span className="footer-divider" />
              SceneSpec v1<span className="revision">r{scene.revision}</span>
            </div>
          </div>
        </main>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={rightTab === 'properties' ? 'active' : ''}
              onClick={() => setRightTab('properties')}
            >
              <Settings2 size={14} />
              属性
            </button>
            <button className={rightTab === 'ai' ? 'active' : ''} onClick={() => setRightTab('ai')}>
              <Sparkles size={14} />
              AI 助手<span className="new-badge">BETA</span>
            </button>
          </div>
          {rightTab === 'properties' ? (
            <Inspector
              scene={scene}
              node={current}
              onChange={change}
              onDelete={() => {
                if (selected) {
                  commit([{ type: 'removeNode', id: selected }]);
                  setSelected(undefined);
                }
              }}
              onFocus={() => runtime.current?.focus(selected)}
              onIsolate={() => {
                runtime.current?.isolate(isolated ? undefined : selected);
                setIsolated(!isolated);
              }}
              onEnvironment={(patch) => commit([{ type: 'setEnvironment', patch }])}
              onConfigure={(patch) => commit([{ type: 'configureScene', patch }])}
            />
          ) : (
            <div className="ai-panel">
              <div className="ai-orb">
                <Sparkles size={26} />
              </div>
              <span className="eyebrow">YOUR CREATIVE COPILOT</span>
              <h2>想象，用一句话开始。</h2>
              <p>描述你的想法，让 AI 为场景添上新的可能。每次修改都可以预览与撤销。</p>
              <div className={`provider-state ${aiConfigured ? 'connected' : ''}`}>
                <span />
                {aiConfigured ? '模型接口已配置' : '连接你的模型，开启 AI 创作'}
                <button onClick={() => setHelp(true)}>
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="ai-suggestions">
                {(scene.mode === 'industrial'
                  ? ['将输出轴改成暖金色金属', '为壳体添加产品说明热点', '添加一个蓝色半透明保护罩']
                  : [
                      '把场景改成温暖的黄昏',
                      '在花园旁添加一棵粉色的树',
                      '为守灯人增加一段关于星空的对话',
                    ]
                ).map((text) => (
                  <button key={text} onClick={() => setPrompt(text)}>
                    <Sparkles size={12} />
                    {text}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              {current && (
                <div className="ai-context">
                  <Box size={12} />
                  当前选择<span>{current.name}</span>
                  <button aria-label="清除选择" onClick={() => setSelected(undefined)}>
                    <X size={11} />
                  </button>
                </div>
              )}
              <div className="prompt-box">
                <textarea
                  aria-label="AI 创作指令"
                  placeholder="描述你想创建或修改的内容…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void askAgent();
                  }}
                />
                <div>
                  <span>Ctrl + Enter 发送</span>
                  {aiBusy ? (
                    <button aria-label="取消 AI 请求" onClick={() => aiAbort.current?.abort()}>
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      aria-label="生成编辑提案"
                      disabled={!prompt.trim()}
                      onClick={() => void askAgent()}
                    >
                      <ArrowUp size={17} />
                    </button>
                  )}
                </div>
              </div>
              {aiBusy && (
                <div className="ai-thinking">
                  <Loader2 size={14} className="spin" />
                  正在规划场景修改…
                </div>
              )}
              {aiError && <div className="ai-error">{aiError}</div>}
              {proposal && (
                <div className="proposal" data-testid="ai-proposal">
                  <span className="eyebrow">修改预览 · r{proposal.baseRevision}</span>
                  <h3>{proposal.summary}</h3>
                  {proposal.commands.map((c, i) => (
                    <div className="proposal-change" key={i}>
                      <Plus size={12} />
                      {describeCommand(c)}
                    </div>
                  ))}
                  <div className="proposal-actions">
                    <button onClick={() => setProposal(null)}>放弃</button>
                    <button
                      className="primary-button"
                      onClick={() => {
                        try {
                          if (proposal.projectId !== scene.id)
                            throw new Error('提案属于其他项目，请重新生成');
                          applyCommands(scene, proposal.baseRevision, proposal.commands);
                          commit(proposal.commands);
                          notify('AI 修改已应用，可撤销');
                        } catch (e) {
                          notify(String(e));
                        }
                      }}
                    >
                      <Check size={13} />
                      应用修改
                    </button>
                  </div>
                </div>
              )}
              <div className="ai-footnote">
                <ShieldCheck size={13} />
                AI 通过场景命令修改内容，原始工程始终可追溯。
              </div>
            </div>
          )}
          <button
            className="inspector-ai-footer"
            onClick={() => setRightTab(rightTab === 'ai' ? 'properties' : 'ai')}
          >
            <span>
              <Sparkles size={16} />
            </span>
            <div>
              {rightTab === 'ai' ? '回到对象属性' : '让灵感，成为可交互的现实'}
              <small>{rightTab === 'ai' ? '精确调整每一个细节' : '试试用一句话修改这个场景'}</small>
            </div>
            <ArrowUpRight size={15} />
          </button>
        </aside>
      </div>
      <footer className="app-status">
        <div>
          <span className="status-green" />
          本地工作空间
          <span className="footer-divider" />
          资源仅保存在你的设备
        </div>
        <div>
          <button
            aria-label="撤销"
            title="撤销 Ctrl+Z"
            disabled={!history.current.canUndo || playing}
            onClick={undo}
          >
            <Undo2 size={14} />
          </button>
          <button
            aria-label="重做"
            title="重做 Ctrl+Shift+Z"
            disabled={!history.current.canRedo || playing}
            onClick={redo}
          >
            <Redo2 size={14} />
          </button>
          <span className="footer-divider" />
          <span>VIRTUALWORLD STUDIO</span>
          <span className="version">v0.1</span>
        </div>
      </footer>
      <input
        ref={fileInput}
        type="file"
        aria-label="导入模型文件"
        className="hidden-input"
        accept=".glb,.step,.stp,.spz,.ply"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importModel(file);
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
          <button aria-label="关闭通知" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <Loader2 size={15} className="spin" />
          {busy}
          {importAbort.current && (
            <button onClick={() => importAbort.current?.abort()}>取消</button>
          )}
        </div>
      )}
      {newProject && (
        <div className="modal-backdrop">
          <div className="modal">
            <button
              className="dialog-close"
              aria-label="关闭新建项目"
              onClick={() => setNewProject(false)}
            >
              <X size={17} />
            </button>
            <span className="eyebrow">A NEW POSSIBILITY</span>
            <h2>从一个新想法开始。</h2>
            <label className="text-field">
              项目名称
              <input
                aria-label="新项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <div className="project-type-options">
              <button
                className={newMode === 'industrial' ? 'active' : ''}
                onClick={() => setNewMode('industrial')}
              >
                <Box size={22} />
                <b>工业展示</b>
                <small>产品 · 装配 · 交互手册</small>
              </button>
              <button
                className={newMode === 'world' ? 'active' : ''}
                onClick={() => setNewMode('world')}
              >
                <Globe2 size={22} />
                <b>交互世界</b>
                <small>场景 · 角色 · 故事</small>
              </button>
            </div>
            <button className="primary-button wide" onClick={createProject}>
              创建项目
              <ArrowUpRight size={15} />
            </button>
          </div>
        </div>
      )}
      {pending && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>保留这次灵感？</h2>
            <p>当前项目有未保存的修改。可以先保存，再打开另一个项目。</p>
            <div className="modal-actions">
              <button onClick={() => setPending(null)}>取消</button>
              <button
                onClick={() => {
                  const next = pending;
                  setPending(null);
                  next();
                }}
              >
                放弃修改
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void save().then((ok) => {
                    if (ok) {
                      const next = pending;
                      setPending(null);
                      next();
                    }
                  });
                }}
              >
                保存并继续
              </button>
            </div>
          </div>
        </div>
      )}
      {validation && (
        <div className="modal-backdrop">
          <div className="modal validation-modal" data-testid="validation-result">
            <button
              className="dialog-close"
              aria-label="关闭验证"
              onClick={() => setValidation(false)}
            >
              <X size={17} />
            </button>
            <CheckCircle2 className="validation-icon" size={38} />
            <h2>场景已通过验证</h2>
            <p>结构、资源引用和当前加载状态均有效。</p>
            <div className="validation-grid">
              <div>
                <b>{scene.nodes.length}</b>
                <span>场景对象</span>
              </div>
              <div>
                <b>{scene.assets.length}</b>
                <span>资源引用</span>
              </div>
              <div>
                <b>{metrics?.fps || '—'}</b>
                <span>当前 FPS</span>
              </div>
            </div>
            <p className="gpu-detail">{metrics?.gpu}</p>
            <p className="property-note">
              当前帧率是本机实时测量，不代表跨设备性能或工程仿真验证。
            </p>
            <button className="primary-button wide" onClick={() => setValidation(false)}>
              回到创作
            </button>
          </div>
        </div>
      )}
      {help && (
        <div className="modal-backdrop">
          <div className="modal help-modal">
            <button className="dialog-close" aria-label="关闭帮助" onClick={() => setHelp(false)}>
              <X size={17} />
            </button>
            <span className="eyebrow">VIRTUALWORLD STUDIO</span>
            <h2>创造，可以进入的世界。</h2>
            <p>在左侧切换工业展示与故事世界，选择对象调整属性，或用 AI 助手提出修改。</p>
            <h3>连接 AI 模型</h3>
            <p>
              在项目目录复制 .env.example 为
              .env，填写兼容接口地址、模型名与密钥，然后重启本地服务。
            </p>
            <pre>
              LLM_BASE_URL=https://你的接口/v1{'\n'}LLM_MODEL=模型名称{'\n'}LLM_API_KEY=你的密钥
            </pre>
            <h3>操作与交付</h3>
            <p>
              拖动旋转 · 右键平移 · 滚轮缩放
              <br />
              Ctrl+S 保存 · Ctrl+Z 撤销 · Esc 退出体验
              <br />
              故事体验：WASD 移动，空格跳跃，E 附近互动。
              <br />
              导出 ZIP 解压后通过静态 HTTP 服务打开。
            </p>
            <p className="property-note">
              STEP
              输入按工程单位转换为米；关节轴和约束需人工确认。无密钥时可体验、编辑和导出两个内置
              Demo。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
