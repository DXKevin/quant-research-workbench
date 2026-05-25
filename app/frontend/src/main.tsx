import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";

type TabKey = "overview" | "filter" | "create" | "metadata";

type Registry = {
  schemaVersion: number;
  rebuiltAt: string;
  families: FamilySummary[];
  variants: StrategyVariant[];
};

type AppConfig = {
  paths: {
    root: string;
    dataRoot: string;
    strategies: string;
    metadata: string;
    registry: string;
  };
  lockedByEnv?: {
    dataRoot: boolean;
    strategies: boolean;
    metadata: boolean;
  };
};

type FamilySummary = Omit<StrategyFamily, "variants"> & {
  path: string;
};

type StrategyFamily = {
  id: string;
  slug: string;
  name: string;
  description: string;
  researchType: string;
  signalType: string;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  path: string;
  variants: StrategyVariant[];
};

type StrategyVariant = {
  id: string;
  familyId: string;
  familySlug: string;
  slug: string;
  name: string;
  description: string;
  assetClass: string;
  universe: string;
  frequency: string;
  rebalanceFrequency: string;
  holdingPeriod: string;
  implementationType: string;
  implementationNotes: string;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  path: string;
};

const tabMeta: Record<TabKey, { label: string; title: string; subtitle: string }> = {
  overview: {
    label: "Overview",
    title: "策略家族",
    subtitle: "查看策略家族和它们下面的子策略实现。"
  },
  create: {
    label: "Create",
    title: "创建策略",
    subtitle: "先创建策略家族，再在家族下创建具体子策略。"
  },
  filter: {
    label: "Filter",
    title: "策略筛选",
    subtitle: "按家族、状态、资产类别、频率和关键词筛选全部子策略。"
  },
  metadata: {
    label: "Metadata",
    title: "索引管理",
    subtitle: "registry.db 是从策略目录重建出来的展示索引。"
  }
};

async function api<T>(requestPath: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(requestPath, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}

function formToObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function tagsToInput(tags: string[]) {
  return tags.join(", ");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function App() {
  const [families, setFamilies] = useState<StrategyFamily[]>([]);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedFamilySlug, setSelectedFamilySlug] = useState("");
  const [selectedVariantSlug, setSelectedVariantSlug] = useState("");
  const [collapsedFamilySlugs, setCollapsedFamilySlugs] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState("");

  const selectedFamily = useMemo(
    () => families.find((family) => family.slug === selectedFamilySlug),
    [families, selectedFamilySlug]
  );

  const selectedVariant = useMemo(
    () => selectedFamily?.variants.find((variant) => variant.slug === selectedVariantSlug),
    [selectedFamily, selectedVariantSlug]
  );

  const totalVariants = useMemo(
    () => families.reduce((total, family) => total + family.variants.length, 0),
    [families]
  );

  async function refresh() {
    const [nextFamilies, nextRegistry, nextConfig] = await Promise.all([
      api<StrategyFamily[]>("/api/families"),
      api<Registry>("/api/registry"),
      api<AppConfig>("/api/config")
    ]);
    setFamilies(nextFamilies);
    setRegistry(nextRegistry);
    setConfig(nextConfig);
    setSelectedFamilySlug((current) => {
      if (nextFamilies.some((family) => family.slug === current)) return current;
      return nextFamilies[0]?.slug || "";
    });
    setSelectedVariantSlug((current) => {
      if (!current) return "";
      const exists = nextFamilies.some((family) => family.variants.some((variant) => variant.slug === current));
      return exists ? current : "";
    });
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function selectFamily(slug: string) {
    setSelectedFamilySlug(slug);
    setSelectedVariantSlug("");
    setActiveTab("overview");
  }

  function selectVariant(familySlug: string, variantSlug: string) {
    setSelectedFamilySlug(familySlug);
    setSelectedVariantSlug(variantSlug);
    setActiveTab("overview");
  }

  function toggleFamilyCollapsed(slug: string) {
    setCollapsedFamilySlugs((current) => {
      const next = new Set(current);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  useEffect(() => {
    refresh().catch((error: Error) => notify(error.message));
  }, []);

  async function createFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const family = await api<StrategyFamily>("/api/families", {
        method: "POST",
        body: JSON.stringify(formToObject(form))
      });
      form.reset();
      selectFamily(family.slug);
      await refresh();
      notify("策略家族已创建");
    } catch (error) {
      notify((error as Error).message);
    }
  }

  async function createVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const payload = formToObject(form);
      const familySlug = String(payload.familySlug);
      delete payload.familySlug;
      const variant = await api<StrategyVariant>(`/api/families/${encodeURIComponent(familySlug)}/variants`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      selectVariant(variant.familySlug, variant.slug);
      await refresh();
      notify("子策略已创建");
    } catch (error) {
      notify((error as Error).message);
    }
  }

  async function updateFamily(family: StrategyFamily, payload: Record<string, FormDataEntryValue>) {
    await api<StrategyFamily>(`/api/families/${encodeURIComponent(family.slug)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await refresh();
    notify("策略家族已更新");
  }

  async function updateVariant(variant: StrategyVariant, payload: Record<string, FormDataEntryValue>) {
    await api<StrategyVariant>(
      `/api/families/${encodeURIComponent(variant.familySlug)}/variants/${encodeURIComponent(variant.slug)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      }
    );
    await refresh();
    notify("子策略已更新");
  }

  async function rebuildRegistry() {
    try {
      const rebuilt = await api<Registry>("/api/metadata/rebuild", { method: "POST", body: "{}" });
      setRegistry(rebuilt);
      await refresh();
      notify("索引已重建");
    } catch (error) {
      notify((error as Error).message);
    }
  }

  async function updateConfig(payload: Record<string, FormDataEntryValue>) {
    const nextConfig = await api<AppConfig>("/api/config", {
      method: "PUT",
      body: JSON.stringify({
        paths: {
          strategies: String(payload.strategies || ""),
          metadata: String(payload.metadata || "")
        }
      })
    });
    setConfig(nextConfig);
    await refresh();
    notify("路径配置已保存");
  }

  const meta = tabMeta[activeTab];

  return (
    <div id="app" className={collapsed ? "sidebar-collapsed" : ""}>
      <Sidebar
        activeTab={activeTab}
        collapsed={collapsed}
        families={families}
        selectedFamilySlug={selectedFamilySlug}
        selectedVariantSlug={selectedVariantSlug}
        collapsedFamilySlugs={collapsedFamilySlugs}
        totalVariants={totalVariants}
        onCollapse={() => setCollapsed((value) => !value)}
        onSelectFamily={selectFamily}
        onSelectVariant={selectVariant}
        onToggleFamily={toggleFamilyCollapsed}
        onSelectTab={setActiveTab}
      />

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{meta.label}</p>
            <h2>{selectedVariant && activeTab === "overview" ? selectedVariant.name : meta.title}</h2>
            <p>{selectedVariant && activeTab === "overview" ? selectedVariant.path : meta.subtitle}</p>
          </div>
          <div className="metric-strip">
            <Metric value={families.length} label="家族" />
            <Metric value={totalVariants} label="子策略" />
          </div>
        </header>

        {activeTab === "overview" && selectedFamily && selectedVariant ? (
          <VariantDetailPage
            variant={selectedVariant}
            onUpdateVariant={updateVariant}
          />
        ) : null}

        {activeTab === "overview" && selectedFamily && !selectedVariant ? (
          <FamilyDetailPage
            selectedFamily={selectedFamily}
            onSelectVariant={selectVariant}
            onUpdateFamily={updateFamily}
          />
        ) : null}

        {activeTab === "filter" ? (
          <FilterPage families={families} onSelectVariant={selectVariant} />
        ) : null}

        {activeTab === "create" ? (
          <CreatePage
            families={families}
            selectedFamilySlug={selectedFamilySlug}
            onSelectFamily={(slug) => {
              setSelectedFamilySlug(slug);
              setSelectedVariantSlug("");
            }}
            onCreateFamily={createFamily}
            onCreateVariant={createVariant}
          />
        ) : null}

        {activeTab === "metadata" ? (
          <MetadataPage registry={registry} config={config} onRebuild={rebuildRegistry} onUpdateConfig={updateConfig} />
        ) : null}
      </main>

      <div id="toast" className={toast ? "show" : ""} role="status">
        {toast}
      </div>
    </div>
  );
}

function Sidebar(props: {
  activeTab: TabKey;
  collapsed: boolean;
  families: StrategyFamily[];
  selectedFamilySlug: string;
  selectedVariantSlug: string;
  collapsedFamilySlugs: Set<string>;
  totalVariants: number;
  onCollapse: () => void;
  onSelectFamily: (slug: string) => void;
  onSelectVariant: (familySlug: string, variantSlug: string) => void;
  onToggleFamily: (slug: string) => void;
  onSelectTab: (tab: TabKey) => void;
}) {
  return (
    <aside className={`sidebar ${props.collapsed ? "collapsed" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark">Q</div>
        <div className="brand-copy">
          <h1>策略工作台</h1>
          <p>Research Workbench</p>
        </div>
        <button
          className="icon-button"
          type="button"
          title={props.collapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={props.collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={props.onCollapse}
        >
          <span>{props.collapsed ? ">" : "<"}</span>
        </button>
      </div>

      <nav className="primary-tabs" aria-label="主导航">
        <TabButton tab="overview" activeTab={props.activeTab} icon="⌂" label="概览" onSelect={props.onSelectTab} />
        <TabButton tab="filter" activeTab={props.activeTab} icon="⌕" label="筛选" onSelect={props.onSelectTab} />
        <TabButton tab="create" activeTab={props.activeTab} icon="+" label="创建" onSelect={props.onSelectTab} />
        <TabButton tab="metadata" activeTab={props.activeTab} icon="↻" label="索引" onSelect={props.onSelectTab} />
      </nav>

      <div className="sidebar-section">
        <div className="section-title">
          <span>策略树</span>
          <span>{props.totalVariants}</span>
        </div>
        <div className="strategy-tree">
          {props.families.length === 0 ? (
            <div className="empty">还没有策略家族</div>
          ) : (
            props.families.map((family) => (
              <div className="tree-group" key={family.id}>
                <button
                  className={`tree-item tree-parent ${
                    family.slug === props.selectedFamilySlug && !props.selectedVariantSlug ? "active" : ""
                  }`}
                  type="button"
                  onClick={() => props.onSelectFamily(family.slug)}
                >
                  <span
                    className={`tree-caret ${props.collapsedFamilySlugs.has(family.slug) ? "collapsed" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onToggleFamily(family.slug);
                    }}
                    title={props.collapsedFamilySlugs.has(family.slug) ? "展开" : "收起"}
                  >
                    ⌄
                  </span>
                  <span className="tree-text">{family.name}</span>
                  <span className="tree-badge">{family.variants.length}</span>
                </button>
                {!props.collapsedFamilySlugs.has(family.slug) ? (
                  <div className="tree-children">
                    {family.variants.map((variant) => (
                      <button
                        className={`tree-item tree-child ${
                          family.slug === props.selectedFamilySlug && variant.slug === props.selectedVariantSlug
                            ? "active"
                            : ""
                        }`}
                        key={variant.id}
                        type="button"
                        onClick={() => props.onSelectVariant(family.slug, variant.slug)}
                      >
                        <span className="tree-dot" />
                        <span className="tree-text">{variant.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function TabButton(props: {
  tab: TabKey;
  activeTab: TabKey;
  icon: string;
  label: string;
  onSelect: (tab: TabKey) => void;
}) {
  return (
    <button
      className={`tab-button ${props.tab === props.activeTab ? "active" : ""}`}
      type="button"
      onClick={() => props.onSelect(props.tab)}
    >
      <span className="tab-icon">{props.icon}</span>
      <span className="tab-label">{props.label}</span>
    </button>
  );
}

function Metric(props: { value: number; label: string }) {
  return (
    <div>
      <span>{props.value}</span>
      <label>{props.label}</label>
    </div>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="performance-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function FamilyDetailPage(props: {
  selectedFamily: StrategyFamily;
  onSelectVariant: (familySlug: string, variantSlug: string) => void;
  onUpdateFamily: (family: StrategyFamily, payload: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  return (
    <section className="page active detail-page">
      <EditableFamilySection
        family={props.selectedFamily}
        onSubmit={(payload) => props.onUpdateFamily(props.selectedFamily, payload)}
      />
      <section className="panel table-panel">
        <div className="panel-header">
          <h3>子策略列表</h3>
          <p>{`${props.selectedFamily.slug} / variants`}</p>
        </div>
        <VariantTable family={props.selectedFamily} onSelectVariant={props.onSelectVariant} />
      </section>
    </section>
  );
}

function FilterPage(props: {
  families: StrategyFamily[];
  onSelectVariant: (familySlug: string, variantSlug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [familySlug, setFamilySlug] = useState("all");
  const [status, setStatus] = useState("all");
  const [assetClass, setAssetClass] = useState("all");
  const [frequency, setFrequency] = useState("all");
  const [signalType, setSignalType] = useState("all");

  const rows = useMemo(
    () =>
      props.families.flatMap((family) =>
        family.variants.map((variant) => ({
          family,
          variant
        }))
      ),
    [props.families]
  );

  const statuses = uniqueOptions(rows.map((row) => row.variant.status));
  const assetClasses = uniqueOptions(rows.map((row) => row.variant.assetClass));
  const frequencies = uniqueOptions(rows.map((row) => row.variant.frequency));
  const signalTypes = uniqueOptions(props.families.map((family) => family.signalType));

  const filteredRows = rows.filter(({ family, variant }) => {
    const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
    const text = [
      family.name,
      family.slug,
      family.description,
      family.researchType,
      family.signalType,
      family.tags.join(" "),
      family.path,
      family.createdAt,
      family.updatedAt,
      variant.name,
      variant.slug,
      variant.description,
      variant.assetClass,
      variant.universe,
      variant.frequency,
      variant.rebalanceFrequency,
      variant.holdingPeriod,
      variant.implementationType,
      variant.status,
      variant.tags.join(" "),
      variant.path,
      variant.createdAt,
      variant.updatedAt
    ]
      .join(" ")
      .normalize("NFKC")
      .toLowerCase();

    return (
      (tokens.length === 0 || tokens.every((token) => text.includes(token))) &&
      (familySlug === "all" || family.slug === familySlug) &&
      (status === "all" || variant.status === status) &&
      (assetClass === "all" || variant.assetClass === assetClass) &&
      (frequency === "all" || variant.frequency === frequency) &&
      (signalType === "all" || family.signalType === signalType)
    );
  });

  function clearFilters() {
    setQuery("");
    setFamilySlug("all");
    setStatus("all");
    setAssetClass("all");
    setFrequency("all");
    setSignalType("all");
  }

  return (
    <section className="page active">
      <section className="panel filter-panel">
        <div className="panel-header filter-header">
          <div>
            <h3>全部策略筛选</h3>
            <p>{`共 ${rows.length} 个子策略，当前显示 ${filteredRows.length} 个。`}</p>
          </div>
          <button className="secondary-button" type="button" onClick={clearFilters}>
            清空筛选
          </button>
        </div>

        <div className="filter-grid">
          <label className="wide-field">
            关键词
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索名称、slug、票池、标签、描述"
            />
          </label>
          <label>
            策略家族
            <select value={familySlug} onChange={(event) => setFamilySlug(event.currentTarget.value)}>
              <option value="all">全部家族</option>
              {props.families.map((family) => (
                <option value={family.slug} key={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
              <option value="all">全部状态</option>
              {statuses.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            资产类别
            <select value={assetClass} onChange={(event) => setAssetClass(event.currentTarget.value)}>
              <option value="all">全部资产</option>
              {assetClasses.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            数据频率
            <select value={frequency} onChange={(event) => setFrequency(event.currentTarget.value)}>
              <option value="all">全部频率</option>
              {frequencies.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            信号类型
            <select value={signalType} onChange={(event) => setSignalType(event.currentTarget.value)}>
              <option value="all">全部信号</option>
              {signalTypes.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel filter-results">
        <div className="strategy-result-row header">
          <span>子策略</span>
          <span>家族</span>
          <span>资产 / 票池</span>
          <span>标签</span>
          <span>频率</span>
          <span>状态</span>
          <span>更新时间</span>
        </div>
        {filteredRows.length === 0 ? (
          <div className="empty">没有符合条件的子策略</div>
        ) : (
          filteredRows.map(({ family, variant }) => (
            <button
              className="strategy-result-row strategy-result-button"
              key={variant.id}
              type="button"
              onClick={() => props.onSelectVariant(family.slug, variant.slug)}
            >
              <strong title={variant.description}>{variant.name}</strong>
              <span title={family.slug}>{family.name}</span>
              <span>{[variant.assetClass, variant.universe].filter(Boolean).join(" / ") || "-"}</span>
              <span title={[...family.tags, ...variant.tags].join(", ")}>
                {uniqueOptions([...family.tags, ...variant.tags]).join(", ") || "-"}
              </span>
              <span>{[variant.frequency, variant.holdingPeriod].filter(Boolean).join(" / ") || "-"}</span>
              <span className={`pill ${variant.status}`}>{variant.status}</span>
              <span>{formatDate(variant.updatedAt)}</span>
            </button>
          ))
        )}
      </section>
    </section>
  );
}

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function VariantTable(props: {
  family?: StrategyFamily;
  onSelectVariant: (familySlug: string, variantSlug: string) => void;
}) {
  if (!props.family) return <div className="variant-table" />;
  if (props.family.variants.length === 0) {
    return <div className="empty">这个家族下面还没有子策略</div>;
  }
  return (
    <div className="variant-table">
      <div className="variant-row header">
        <span>名称</span>
        <span>资产 / 票池</span>
        <span>频率 / 持有</span>
        <span>状态</span>
        <span>路径</span>
      </div>
      {props.family.variants.map((variant) => (
        <button
          className="variant-row variant-row-button"
          key={variant.id}
          type="button"
          onClick={() => props.onSelectVariant(props.family!.slug, variant.slug)}
        >
          <strong title={variant.description}>{variant.name}</strong>
          <span>{[variant.assetClass, variant.universe].filter(Boolean).join(" / ") || "-"}</span>
          <span>{[variant.frequency, variant.holdingPeriod].filter(Boolean).join(" / ") || "-"}</span>
          <span className={`pill ${variant.status}`}>{variant.status}</span>
          <span title={variant.path}>{variant.path}</span>
        </button>
      ))}
    </div>
  );
}

function VariantDetailPage(props: {
  variant: StrategyVariant;
  onUpdateVariant: (variant: StrategyVariant, payload: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  return (
    <section className="page active detail-page">
      <EditableVariantSection
        variant={props.variant}
        onSubmit={(payload) => props.onUpdateVariant(props.variant, payload)}
      />
      <section className="panel detail-section performance-placeholder">
        <div className="panel-header">
          <h3>策略表现</h3>
          <p>后续可放回测收益、风险指标、图表和最近运行记录。</p>
        </div>
        <div className="performance-grid">
          <MetricCard label="年化收益" value="-" />
          <MetricCard label="最大回撤" value="-" />
          <MetricCard label="Sharpe" value="-" />
          <MetricCard label="胜率" value="-" />
        </div>
        <div className="chart-placeholder">
          <span>Performance chart placeholder</span>
        </div>
      </section>
    </section>
  );
}

function EditableFamilySection(props: {
  family: StrategyFamily;
  onSubmit: (payload: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await props.onSubmit(formToObject(event.currentTarget));
      setEditing(false);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel detail-section">
      <div className="panel-header detail-header">
        <div>
          <h3>策略家族信息</h3>
          <p>{props.family.path}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)}>
          {editing ? "取消" : "编辑"}
        </button>
      </div>
      {editing ? (
        <form className="edit-form" onSubmit={submit}>
          <label>
            名称
            <input name="name" required defaultValue={props.family.name} />
          </label>
          <label>
            研究类型
            <select name="researchType" defaultValue={props.family.researchType}>
              <option value="signal">信号</option>
              <option value="strategy">完整策略</option>
              <option value="portfolio">组合构建</option>
              <option value="risk_model">风险模型</option>
              <option value="data_pipeline">数据处理</option>
            </select>
          </label>
          <label>
            信号类型
            <select name="signalType" defaultValue={props.family.signalType}>
              <option value="cross_sectional">截面信号</option>
              <option value="time_series">时间序列信号</option>
              <option value="hybrid">混合型</option>
              <option value="none">非信号类</option>
            </select>
          </label>
          <label>
            状态
            <select name="status" defaultValue={props.family.status}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label>
            标签
            <input name="tags" defaultValue={tagsToInput(props.family.tags)} />
          </label>
          <label className="wide-field">
            描述
            <textarea name="description" rows={3} defaultValue={props.family.description} />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存家族信息"}
          </button>
        </form>
      ) : (
        <InfoGrid
          items={[
            ["名称", props.family.name],
            ["Slug", props.family.slug],
            ["研究类型", props.family.researchType],
            ["信号类型", props.family.signalType],
            ["状态", props.family.status],
            ["创建时间", formatDate(props.family.createdAt)],
            ["更新时间", formatDate(props.family.updatedAt)],
            ["标签", props.family.tags.join(", ") || "-"],
            ["描述", props.family.description || "暂无描述"]
          ]}
        />
      )}
    </section>
  );
}

function EditableVariantSection(props: {
  variant: StrategyVariant;
  onSubmit: (payload: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await props.onSubmit(formToObject(event.currentTarget));
      setEditing(false);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel detail-section">
      <div className="panel-header detail-header">
        <div>
          <h3>子策略信息</h3>
          <p>{props.variant.path}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)}>
          {editing ? "取消" : "编辑"}
        </button>
      </div>
      {editing ? (
        <form className="edit-form" onSubmit={submit}>
          <label>
            名称
            <input name="name" required defaultValue={props.variant.name} />
          </label>
          <label>
            资产类别
            <select name="assetClass" defaultValue={props.variant.assetClass || "equity"}>
              <option value="equity">equity</option>
              <option value="futures">futures</option>
              <option value="crypto">crypto</option>
              <option value="fund">fund</option>
              <option value="option">option</option>
              <option value="multi_asset">multi_asset</option>
            </select>
          </label>
          <label>
            票池
            <input name="universe" defaultValue={props.variant.universe} />
          </label>
          <label>
            数据频率
            <select name="frequency" defaultValue={props.variant.frequency || "daily"}>
              <option value="daily">daily</option>
              <option value="intraday">intraday</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
            </select>
          </label>
          <label>
            调仓频率
            <select name="rebalanceFrequency" defaultValue={props.variant.rebalanceFrequency || "daily"}>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="event_driven">event_driven</option>
            </select>
          </label>
          <label>
            持有周期
            <input name="holdingPeriod" defaultValue={props.variant.holdingPeriod} />
          </label>
          <label>
            实现类型
            <input name="implementationType" defaultValue={props.variant.implementationType} />
          </label>
          <label>
            状态
            <select name="status" defaultValue={props.variant.status}>
              <option value="idea">idea</option>
              <option value="draft">draft</option>
              <option value="backtesting">backtesting</option>
              <option value="validated">validated</option>
              <option value="live">live</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label>
            标签
            <input name="tags" defaultValue={tagsToInput(props.variant.tags)} />
          </label>
          <label className="wide-field">
            描述
            <textarea name="description" rows={3} defaultValue={props.variant.description} />
          </label>
          <label className="wide-field">
            实现备注
            <textarea name="implementationNotes" rows={3} defaultValue={props.variant.implementationNotes} />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存子策略信息"}
          </button>
        </form>
      ) : (
        <InfoGrid
          items={[
            ["名称", props.variant.name],
            ["Slug", props.variant.slug],
            ["资产类别", props.variant.assetClass || "-"],
            ["票池", props.variant.universe || "-"],
            ["数据频率", props.variant.frequency || "-"],
            ["调仓频率", props.variant.rebalanceFrequency || "-"],
            ["持有周期", props.variant.holdingPeriod || "-"],
            ["实现类型", props.variant.implementationType || "-"],
            ["状态", props.variant.status],
            ["创建时间", formatDate(props.variant.createdAt)],
            ["更新时间", formatDate(props.variant.updatedAt)],
            ["标签", props.variant.tags.join(", ") || "-"],
            ["描述", props.variant.description || "暂无描述"],
            ["实现备注", props.variant.implementationNotes || "-"]
          ]}
        />
      )}
    </section>
  );
}

function InfoGrid(props: { items: Array<[string, string]> }) {
  return (
    <dl className="info-grid">
      {props.items.map(([label, value]) => (
        <div className="info-item" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CreatePage(props: {
  families: StrategyFamily[];
  selectedFamilySlug: string;
  onSelectFamily: (slug: string) => void;
  onCreateFamily: (event: FormEvent<HTMLFormElement>) => void;
  onCreateVariant: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="page active">
      <div className="content-grid">
        <FamilyForm onSubmit={props.onCreateFamily} />
        <VariantForm
          families={props.families}
          selectedFamilySlug={props.selectedFamilySlug}
          onSelectFamily={props.onSelectFamily}
          onSubmit={props.onCreateVariant}
        />
      </div>
    </section>
  );
}

function FamilyForm(props: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="panel" onSubmit={props.onSubmit}>
      <div className="panel-header">
        <h3>新建策略家族</h3>
        <p>只填写核心研究逻辑，不预设资产类别或票池。</p>
      </div>
      <label>
        名称
        <input name="name" required placeholder="价格均值回归" />
      </label>
      <label>
        Slug
        <input name="slug" required placeholder="price_mean_reversion" />
      </label>
      <label>
        研究类型
        <select name="researchType" defaultValue="signal">
          <option value="signal">信号</option>
          <option value="strategy">完整策略</option>
          <option value="portfolio">组合构建</option>
          <option value="risk_model">风险模型</option>
          <option value="data_pipeline">数据处理</option>
        </select>
      </label>
      <label>
        信号类型
        <select name="signalType" defaultValue="cross_sectional">
          <option value="cross_sectional">截面信号</option>
          <option value="time_series">时间序列信号</option>
          <option value="hybrid">混合型</option>
          <option value="none">非信号类</option>
        </select>
      </label>
      <label>
        状态
        <select name="status" defaultValue="draft">
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <label>
        标签
        <input name="tags" placeholder="mean-reversion, price" />
      </label>
      <label>
        描述
        <textarea name="description" rows={4} placeholder="描述这套核心研究逻辑" />
      </label>
      <button type="submit">创建家族</button>
    </form>
  );
}

function VariantForm(props: {
  families: StrategyFamily[];
  selectedFamilySlug: string;
  onSelectFamily: (slug: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="panel" onSubmit={props.onSubmit}>
      <div className="panel-header">
        <h3>新建子策略</h3>
        <p>子策略记录具体应用、票池、频率和实现差异。</p>
      </div>
      <label>
        所属家族
        <select
          name="familySlug"
          required
          value={props.selectedFamilySlug}
          onChange={(event) => props.onSelectFamily(event.currentTarget.value)}
        >
          {props.families.map((family) => (
            <option value={family.slug} key={family.id}>
              {family.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        名称
        <input name="name" required placeholder="沪深300日频基础版本" />
      </label>
      <label>
        Slug
        <input name="slug" required placeholder="csi300_daily_baseline" />
      </label>
      <div className="two-col">
        <label>
          资产类别
          <select name="assetClass" defaultValue="equity">
            <option value="equity">equity</option>
            <option value="futures">futures</option>
            <option value="crypto">crypto</option>
            <option value="fund">fund</option>
            <option value="option">option</option>
            <option value="multi_asset">multi_asset</option>
          </select>
        </label>
        <label>
          票池
          <input name="universe" placeholder="CSI300" />
        </label>
      </div>
      <div className="two-col">
        <label>
          数据频率
          <select name="frequency" defaultValue="daily">
            <option value="daily">daily</option>
            <option value="intraday">intraday</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </select>
        </label>
        <label>
          调仓频率
          <select name="rebalanceFrequency" defaultValue="daily">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="event_driven">event_driven</option>
          </select>
        </label>
      </div>
      <div className="two-col">
        <label>
          持有周期
          <input name="holdingPeriod" placeholder="1d / 5d / 20d" />
        </label>
        <label>
          状态
          <select name="status" defaultValue="draft">
            <option value="idea">idea</option>
            <option value="draft">draft</option>
            <option value="backtesting">backtesting</option>
            <option value="validated">validated</option>
            <option value="live">live</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>
      <label>
        实现类型
        <input name="implementationType" placeholder="baseline / industry_neutral" />
      </label>
      <label>
        标签
        <input name="tags" placeholder="csi300, baseline" />
      </label>
      <label>
        描述
        <textarea name="description" rows={3} placeholder="描述这个子策略做了什么" />
      </label>
      <label>
        实现备注
        <textarea name="implementationNotes" rows={3} placeholder="记录去极值、中性化、参数等差异" />
      </label>
      <button type="submit" disabled={props.families.length === 0}>
        创建子策略
      </button>
    </form>
  );
}

function MetadataPage(props: {
  registry: Registry | null;
  config: AppConfig | null;
  onRebuild: () => void;
  onUpdateConfig: (payload: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  const familyCount = props.registry?.families?.length || 0;
  const variantCount = props.registry?.variants?.length || 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await props.onUpdateConfig(formToObject(event.currentTarget));
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page active">
      <section className="panel metadata-panel">
        <div className="panel-header">
          <h3>可重建索引</h3>
          <p>索引来自 strategies 目录下的 family.json 和 strategy.json，可以随时重建。</p>
        </div>
        <div className="metadata-actions">
          <button type="button" onClick={props.onRebuild}>
            重建索引
          </button>
          <span>{`metadata/registry.db · ${familyCount} families · ${variantCount} variants`}</span>
        </div>
        {props.config ? (
          <form className="path-form" key={`${props.config.paths.strategies}:${props.config.paths.metadata}`} onSubmit={submit}>
            <label>
              策略目录
              <input
                name="strategies"
                defaultValue={props.config.paths.strategies}
                disabled={props.config.lockedByEnv?.strategies}
              />
            </label>
            <label>
              Metadata 目录
              <input
                name="metadata"
                defaultValue={props.config.paths.metadata}
                disabled={props.config.lockedByEnv?.metadata}
              />
            </label>
            {props.config.lockedByEnv?.strategies || props.config.lockedByEnv?.metadata ? (
              <div className="form-error">当前路径被环境变量锁定，需要修改启动环境变量后重启后端。</div>
            ) : null}
            {error ? <div className="form-error">{error}</div> : null}
            <button type="submit" disabled={saving || props.config.lockedByEnv?.strategies || props.config.lockedByEnv?.metadata}>
              {saving ? "保存中..." : "保存路径配置"}
            </button>
          </form>
        ) : null}
        <pre className="registry-preview">{JSON.stringify(props.registry || {}, null, 2)}</pre>
      </section>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
