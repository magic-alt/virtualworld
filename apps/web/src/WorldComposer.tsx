import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import {
  GenerationInput,
  phaseLabels,
  type GenerationJob,
  type GenerationCapabilities,
  type GenerationRequest,
} from '../shared/generation';
import { api, json, readPreference, writePreference } from './api';
export function WorldComposer({
  onOpen,
  onComplete,
}: {
  onOpen: (id: string) => void;
  onComplete: () => void;
}) {
  const [description, setDescription] = useState(''),
    [file, setFile] = useState<File>(),
    [preview, setPreview] = useState('');
  const [capabilities, setCapabilities] = useState<GenerationCapabilities>({
      llm: false,
      tripo: false,
    }),
    [planner, setPlanner] = useState<'builtin' | 'llm'>('builtin'),
    [assets, setAssets] = useState<'builtin' | 'tripo'>('builtin'),
    [paid, setPaid] = useState(false);
  const [job, setJob] = useState<GenerationJob>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [taskId, setTaskId] = useState(''),
    [taskNodeId, setTaskNodeId] = useState('');
  const [jobId, setJobId] = useState(() => readPreference('vw-generation-job') || ''),
    [pollVersion, setPollVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null),
    submission = useRef<{ fingerprint: string; input: GenerationRequest } | undefined>(undefined),
    notified = useRef(''),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    try {
      const saved = JSON.parse(readPreference('vw-generation-submission') || 'null');
      if (saved)
        submission.current = {
          fingerprint: String(saved.fingerprint),
          input: GenerationInput.parse(saved.input),
        };
    } catch {
      /* Ignore invalid optional browser state. */
    }
    const controller = new AbortController();
    void api('/api/generation/capabilities', { signal: controller.signal })
      .then((c) => {
        setCapabilities(c);
        setPlanner(c.llm ? 'llm' : 'builtin');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next: GenerationJob = await api(`/api/generations/${encodeURIComponent(jobId)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(next);
        if (next.phase === 'complete' && notified.current !== next.id) {
          notified.current = next.id;
          onComplete();
        }
        if (['complete', 'failed', 'interrupted'].includes(next.phase)) return;
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(`任务查询失败，可使用原请求确认提交：${e instanceof Error ? e.message : e}`);
      }
      timer = setTimeout(poll, 1200);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, pollVersion]);
  const running = !!job && !['complete', 'failed', 'interrupted'].includes(job.phase);
  async function send(request: GenerationRequest) {
    writePreference('vw-generation-job', request.requestId);
    const next: GenerationJob = await api('/api/generations', { method: 'POST', ...json(request) });
    if (!active.current) return;
    setJob(next);
    setJobId(next.id);
    setPollVersion((v) => v + 1);
  }
  async function submit(replay = false) {
    if ((!replay && !description.trim()) || busy || running) return;
    setBusy(true);
    setError('');
    setJob(undefined);
    try {
      const fingerprint = JSON.stringify([
        description.trim(),
        planner,
        assets,
        paid,
        file ? [file.name, file.size, file.lastModified] : null,
      ]);
      if (!replay && submission.current?.fingerprint !== fingerprint) {
        let referenceId: string | undefined;
        if (file)
          referenceId = (
            await api(`/api/generation/references?name=${encodeURIComponent(file.name)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: file,
            })
          ).id;
        submission.current = {
          fingerprint,
          input: {
            requestId: crypto.randomUUID(),
            description: description.trim(),
            planner,
            assets,
            allowPaid: assets === 'tripo' && paid,
            referenceId,
          },
        };
        writePreference('vw-generation-submission', JSON.stringify(submission.current));
      }
      if (submission.current) await send(submission.current.input);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function resume() {
    if (!job || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api(`/api/generations/${job.id}/resume`, {
        method: 'POST',
        ...json({ taskId: taskId.trim() || undefined, taskNodeId: taskNodeId.trim() || undefined }),
      });
      if (!active.current) return;
      setJob(next);
      setPollVersion((v) => v + 1);
    } catch (e) {
      if (active.current) setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="world-composer">
      <div className="composer-input">
        <Sparkles size={22} strokeWidth={1.4} />
        <textarea
          aria-label="描述你的世界"
          placeholder="想象一座漂浮在云海中的花园，黄昏时，星光落在古老的石桥上…"
          maxLength={4000}
          value={description}
          disabled={busy || running}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      {preview && (
        <div className="reference-preview">
          <img src={preview} alt="世界参考图" />
          <span>{file?.name}</span>
          <button
            aria-label="移除参考图"
            disabled={busy || running}
            onClick={() => setFile(undefined)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="composer-actions">
        <input
          ref={inputRef}
          type="file"
          hidden
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = '';
            if (!next) return;
            if (next.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(next.type)) {
              setError('请选择不超过 20 MiB 的 PNG/JPEG 图片');
              return;
            }
            setFile(next);
          }}
        />
        <button
          className="reference-button"
          disabled={planner !== 'llm' || busy || running}
          title={planner !== 'llm' ? '参考图需要配置 AI 服务' : '添加参考图'}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={17} /> 添加参考图
        </button>
        <div className="composer-selects">
          <select
            aria-label="世界生成模式"
            value={planner}
            disabled={busy || running}
            onChange={(e) => {
              setPlanner(e.target.value as 'llm' | 'builtin');
              if (e.target.value === 'builtin') setFile(undefined);
            }}
          >
            <option value="builtin">程序化体验</option>
            <option value="llm" disabled={!capabilities.llm}>
              AI 世界生成{capabilities.llm ? '' : ' · 未配置'}
            </option>
          </select>
          <select
            aria-label="世界资产来源"
            value={assets}
            disabled={busy || running}
            onChange={(e) => {
              setAssets(e.target.value as 'builtin' | 'tripo');
              setPaid(false);
            }}
          >
            <option value="builtin">内置资产</option>
            <option value="tripo" disabled={!capabilities.tripo}>
              Tripo 模型{capabilities.tripo ? ' · 付费' : ' · 未配置'}
            </option>
          </select>
        </div>
        <button
          className="composer-submit"
          aria-label="生成世界"
          disabled={busy || running || !description.trim() || (assets === 'tripo' && !paid)}
          onClick={() => void submit()}
        >
          {busy || running ? <Loader2 size={19} className="spin" /> : <ArrowUp size={21} />}
        </button>
      </div>
      {assets === 'tripo' && (
        <label className="paid-consent">
          <input
            type="checkbox"
            checked={paid}
            disabled={busy || running}
            onChange={(e) => setPaid(e.target.checked)}
          />
          我选择使用 Tripo，理解生成资产可能产生费用。
        </label>
      )}
      <div className="composer-footnote">
        <span className={`provider-dot ${planner === 'llm' ? 'connected' : ''}`} />
        {planner === 'llm' ? 'AI 根据描述规划可探索的世界' : '程序化体验 · 不调用 AI 模型'}
        <span>{description.length}/4000</span>
      </div>
      <div className="prompt-inspirations">
        <span>试着想象</span>
        {['蓝色晶石与古树环绕的森林', '有向导和归航任务的星光花园', '夕阳下藏着秘密的沙漠绿洲'].map(
          (text) => (
            <button key={text} disabled={busy || running} onClick={() => setDescription(text)}>
              {text} <ArrowRight size={12} />
            </button>
          ),
        )}
      </div>
      {error && (
        <p className="world-error" role="alert">
          {error}
          {submission.current && !running && (
            <button disabled={busy} onClick={() => void submit(true)}>
              使用原请求确认提交
            </button>
          )}
        </p>
      )}
      {job && (
        <div
          className={`generation-progress ${job.phase}`}
          role="status"
          data-testid="generation-progress"
        >
          <div>
            <span className="world-eyebrow">
              {job.input.planner === 'builtin' ? 'PROCEDURAL WORLD' : 'YOUR WORLD IS TAKING SHAPE'}
            </span>
            <h3>{phaseLabels[job.phase]}</h3>
            <p>{job.input.description}</p>
          </div>
          {running && <Loader2 className="spin" />}
          <ol>
            {(['planning', 'assets', 'validating', 'complete'] as const).map((phase, i, phases) => (
              <li
                key={phase}
                className={phases.indexOf(job.phase as typeof phase) >= i ? 'reached' : ''}
              >
                {String(i + 1).padStart(2, '0')} {phaseLabels[phase]}
              </li>
            ))}
          </ol>
          {job.error && <p className="world-error">{job.error}</p>}
          {job.phase === 'complete' && (
            <button className="world-button dark" onClick={() => onOpen(job.worldId)}>
              进入我的世界 <ArrowRight size={17} />
            </button>
          )}
          {['failed', 'interrupted'].includes(job.phase) && (
            <div className="generation-recovery">
              <p>恢复沿用已有任务记录，不会自动重建结果不明的付费任务。</p>
              <input
                aria-label="恢复任务 ID"
                placeholder="已有 Tripo task ID（可选）"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
              />
              <input
                aria-label="恢复资产节点 ID"
                placeholder="多资产时填写节点 ID（可选）"
                value={taskNodeId}
                onChange={(e) => setTaskNodeId(e.target.value)}
              />
              <button disabled={busy} onClick={() => void resume()}>
                恢复此任务
              </button>
            </div>
          )}
          <small>任务 {job.id}</small>
        </div>
      )}
    </div>
  );
}
