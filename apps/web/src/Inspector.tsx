import {
  ChevronDown,
  Box,
  Trash2,
  Focus,
  Eye,
  Layers,
  Link2,
  MessageSquare,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import type { SceneNode, SceneSpec, Vector3Tuple } from '@virtualworld/scene-schema';
export function VectorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vector3Tuple;
  onChange: (v: Vector3Tuple) => void;
}) {
  return (
    <div className="vector-row">
      <label>{label}</label>
      <div className="vector-inputs">
        {value.map((v, i) => (
          <label key={`${i}-${v}`}>
            <span className={`axis-${i}`}>{'XYZ'[i]}</span>
            <input
              aria-label={`${label} ${'XYZ'[i]}`}
              type="number"
              step="0.1"
              defaultValue={Number(v.toFixed(4))}
              onBlur={(e) => {
                const num = Number(e.target.value);
                if (!Number.isFinite(num) || num === v) return;
                const next = [...value] as Vector3Tuple;
                next[i] = num;
                onChange(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="property-section">
      <h3>
        <ChevronDown size={13} />
        {title}
      </h3>
      {children}
    </section>
  );
}
export function Inspector({
  scene,
  node,
  onChange,
  onDelete,
  onFocus,
  onIsolate,
  onEnvironment,
  onConfigure,
}: {
  scene: SceneSpec;
  node?: SceneNode;
  onChange: (patch: Partial<SceneNode>) => void;
  onDelete: () => void;
  onFocus: () => void;
  onIsolate: () => void;
  onEnvironment: (patch: Partial<SceneSpec['environment']>) => void;
  onConfigure: (patch: Partial<Pick<SceneSpec, 'camera' | 'spawn' | 'tasks'>>) => void;
}) {
  if (!node)
    return (
      <div className="inspector-content">
        <div className="empty-selection">
          <Layers size={30} />
          <h3>选择一个对象</h3>
          <p>
            在场景或左侧对象树中选择，
            <br />
            查看并编辑它的属性。
          </p>
        </div>
        <Section title="场景环境">
          <div className="field-line">
            <label>背景色</label>
            <input
              aria-label="场景背景色"
              type="color"
              value={scene.environment.background}
              onChange={(e) => onEnvironment({ background: e.target.value })}
            />
          </div>
          {(['lightIntensity', 'ambientIntensity', 'fog'] as const).map((key) => (
            <div className="field-line" key={key}>
              <label>
                {{ lightIntensity: '主光强度', ambientIntensity: '环境光强度', fog: '雾浓度' }[key]}
              </label>
              <input
                type="number"
                step={key === 'fog' ? 0.005 : 0.1}
                min="0"
                aria-label={key}
                value={scene.environment[key] ?? 0}
                onChange={(e) => onEnvironment({ [key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </Section>
        <Section title="默认镜头">
          <VectorField
            label="镜头"
            value={scene.camera.position}
            onChange={(position) => onConfigure({ camera: { ...scene.camera, position } })}
          />
          <VectorField
            label="目标"
            value={scene.camera.target}
            onChange={(target) => onConfigure({ camera: { ...scene.camera, target } })}
          />
        </Section>
        {scene.mode === 'world' && (
          <>
            <Section title="角色出生点">
              <VectorField
                label="起点"
                value={scene.spawn}
                onChange={(spawn) => onConfigure({ spawn })}
              />
            </Section>
            <Section title="任务手记">
              {scene.tasks.map((task, i) => (
                <div className="text-field" key={task.flag}>
                  <label>
                    {task.flag}
                    <button
                      aria-label={`删除任务 ${task.label}`}
                      onClick={() =>
                        onConfigure({ tasks: scene.tasks.filter((_, index) => i !== index) })
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  </label>
                  <input
                    aria-label={`任务名称 ${task.flag}`}
                    key={task.label}
                    defaultValue={task.label}
                    onBlur={(e) => {
                      if (e.target.value.trim())
                        onConfigure({
                          tasks: scene.tasks.map((t, index) =>
                            index === i ? { ...t, label: e.target.value.trim() } : t,
                          ),
                        });
                    }}
                  />
                </div>
              ))}
              <select
                className="task-add-select"
                aria-label="添加任务标记"
                value=""
                onChange={(e) => {
                  const flag = e.target.value;
                  if (flag)
                    onConfigure({
                      tasks: [
                        ...scene.tasks,
                        {
                          flag,
                          label:
                            scene.nodes.find((n) => n.interaction?.gives === flag)?.interaction
                              ?.title || flag,
                        },
                      ],
                    });
                }}
              >
                <option value="">添加一个已有的交互标记…</option>
                {[
                  ...new Set(
                    scene.nodes.flatMap((n) => (n.interaction?.gives ? [n.interaction.gives] : [])),
                  ),
                ]
                  .filter((flag) => !scene.tasks.some((t) => t.flag === flag))
                  .map((flag) => (
                    <option key={flag} value={flag}>
                      {flag}
                    </option>
                  ))}
              </select>
            </Section>
          </>
        )}
      </div>
    );
  return (
    <div className="inspector-content" key={node.id}>
      <div className="object-heading">
        <div className="object-icon">
          <Box size={20} />
        </div>
        <div>
          <span className="eyebrow">
            {node.kind === 'splat'
              ? 'GAUSSIAN SPLAT'
              : node.kind === 'group'
                ? 'GROUP'
                : 'SCENE OBJECT'}
          </span>
          <input
            aria-label="对象名称"
            key={node.name}
            defaultValue={node.name}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== node.name)
                onChange({ name: e.target.value.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
      </div>
      <div className="inspector-actions">
        <button onClick={onFocus}>
          <Focus size={13} />
          定位
        </button>
        <button onClick={onIsolate}>
          <Eye size={13} />
          隔离
        </button>
        <button title="删除对象" aria-label="删除对象" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
      <Section title="变换">
        <VectorField
          label="位置"
          value={node.position}
          onChange={(position) => onChange({ position })}
        />
        <VectorField
          label="旋转"
          value={node.rotation}
          onChange={(rotation) => onChange({ rotation })}
        />
        <VectorField label="缩放" value={node.scale} onChange={(scale) => onChange({ scale })} />
        <div className="property-note">位置单位 m · 旋转单位 rad</div>
      </Section>
      {node.kind !== 'group' && (
        <Section title="材质与外观">
          <div
            className="material-preview"
            style={{ '--material-color': node.color } as React.CSSProperties}
          >
            <div />
            <span>
              标准表面材质<small>PBR · 实时渲染</small>
            </span>
          </div>
          <div className="field-line">
            <label>基础颜色</label>
            <div className="color-field">
              <input
                aria-label="对象颜色"
                type="color"
                value={node.color}
                onChange={(e) => onChange({ color: e.target.value, materialOverride: true })}
              />
              <span>{node.color.toUpperCase()}</span>
            </div>
          </div>
          {(['metalness', 'roughness'] as const).map((key) => (
            <div className="range-field" key={key}>
              <label>
                {key === 'metalness' ? '金属度' : '粗糙度'}
                <span>{(node[key] ?? (key === 'metalness' ? 0.05 : 0.72)).toFixed(2)}</span>
              </label>
              <input
                aria-label={key === 'metalness' ? '金属度' : '粗糙度'}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={node[key] ?? (key === 'metalness' ? 0.05 : 0.72)}
                onChange={(e) => onChange({ [key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </Section>
      )}
      {scene.mode === 'industrial' && (
        <Section title="爆炸视图">
          <VectorField
            label="偏移"
            value={node.explode || [0, 0, 0]}
            onChange={(explode) => onChange({ explode })}
          />
          <p className="property-note">在视口工具栏拖动「展开」预览拆解。</p>
        </Section>
      )}
      {node.joint && (
        <Section title="关节运动">
          <div className="confirmation">
            <ShieldCheck size={13} />
            {node.joint.confirmed ? '已确认的运动参数' : 'AI 建议 · 等待人工确认'}
          </div>
          <div className="field-line">
            <label>旋转轴</label>
            <select
              aria-label="关节轴"
              value={node.joint.axis}
              onChange={(e) =>
                onChange({ joint: { ...node.joint!, axis: e.target.value as 'x' | 'y' | 'z' } })
              }
            >
              {['x', 'y', 'z'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="range-field">
            <label>
              关节角度<span>{Math.round((node.joint.value * 180) / Math.PI)}°</span>
            </label>
            <input
              aria-label="关节角度"
              type="range"
              min={node.joint.min}
              max={node.joint.max}
              step="0.01"
              value={node.joint.value}
              onChange={(e) =>
                onChange({ joint: { ...node.joint!, value: Number(e.target.value) } })
              }
            />
          </div>
          <div className="field-line">
            <label>最小 / 最大 (rad)</label>
            <div className="limit-inputs">
              {(['min', 'max'] as const).map((k) => (
                <input
                  aria-label={`关节${k}`}
                  key={`${k}-${node.joint![k]}`}
                  type="number"
                  step="0.1"
                  defaultValue={node.joint![k]}
                  onBlur={(e) =>
                    onChange({ joint: { ...node.joint!, [k]: Number(e.target.value) } })
                  }
                />
              ))}
            </div>
          </div>
          {!node.joint.confirmed && (
            <button
              className="subtle-button"
              onClick={() => onChange({ joint: { ...node.joint!, confirmed: true } })}
            >
              确认这些运动参数
            </button>
          )}
        </Section>
      )}
      {!node.joint && scene.mode === 'industrial' && node.kind === 'mesh' && (
        <button
          className="add-property"
          onClick={() =>
            onChange({
              joint: { axis: 'y', min: -Math.PI / 2, max: Math.PI / 2, value: 0, confirmed: false },
            })
          }
        >
          <Link2 size={13} />
          添加旋转关节
        </button>
      )}
      <Section title="交互说明">
        {node.interaction ? (
          <>
            <div className="text-field">
              <label>标题</label>
              <input
                aria-label="交互标题"
                key={node.interaction.title}
                defaultValue={node.interaction.title}
                onBlur={(e) =>
                  onChange({ interaction: { ...node.interaction!, title: e.target.value } })
                }
              />
            </div>
            <div className="text-field">
              <label>内容</label>
              <textarea
                aria-label="交互内容"
                key={node.interaction.text}
                defaultValue={node.interaction.text}
                rows={4}
                onBlur={(e) =>
                  onChange({ interaction: { ...node.interaction!, text: e.target.value } })
                }
              />
            </div>
            {node.interaction.requires?.length ? (
              <p className="property-note">前置条件：{node.interaction.requires.join('、')}</p>
            ) : null}
            <div className="text-field">
              <label>获得的任务标记</label>
              <input
                aria-label="任务标记"
                key={node.interaction.gives || 'none'}
                defaultValue={node.interaction.gives || ''}
                placeholder="例如 found-star"
                onBlur={(e) =>
                  onChange({
                    interaction: { ...node.interaction!, gives: e.target.value || undefined },
                  })
                }
              />
            </div>
          </>
        ) : (
          <button
            className="subtle-button"
            onClick={() =>
              onChange({ interaction: { title: node.name, text: '在此编写产品说明或故事内容。' } })
            }
          >
            <MessageSquare size={13} />
            添加交互内容
          </button>
        )}
      </Section>
      <Section title="碰撞代理">
        {node.collider ? (
          <>
            <div className="field-line">
              <label>形状</label>
              <select
                aria-label="碰撞形状"
                value={node.collider.shape}
                onChange={(e) =>
                  onChange({
                    collider: { ...node.collider!, shape: e.target.value as 'box' | 'ball' },
                  })
                }
              >
                <option value="box">包围盒</option>
                <option value="ball">球体</option>
              </select>
            </div>
            <VectorField
              label="尺寸"
              value={node.collider.size}
              onChange={(size) => onChange({ collider: { ...node.collider!, size } })}
            />
          </>
        ) : (
          <button
            className="subtle-button"
            onClick={() => onChange({ collider: { shape: 'box', size: node.size } })}
          >
            <Plus size={13} />
            添加碰撞代理
          </button>
        )}
      </Section>
      <div className="object-id">
        OBJECT ID <span>{node.id}</span>
      </div>
    </div>
  );
}
