import { Bot, ChevronRight, Factory, Layers, Warehouse, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { TreeNode } from "../../api/types";
import { cx } from "../../ui/Field";
import { isNodeSelected, selectedPath } from "./params";

const KIND_ICON: Record<TreeNode["kind"], LucideIcon> = {
  industry: Factory,
  facility: Warehouse,
  process: Workflow,
  solution_type: Bot,
  other: Layers,
};

const KIND_TITLE: Record<TreeNode["kind"], string> = {
  industry: "Отрасль",
  facility: "Тип объекта",
  process: "Процесс",
  solution_type: "Тип решения",
  other: "Решения отрасли вне описанных объектов",
};

interface CatalogTreeProps {
  nodes: TreeNode[];
  params: URLSearchParams;
  total: number | null;
  onSelect: (node: TreeNode | null) => void;
}

/** Иерархия п. 3.3.1 ТЗ: отрасль → тип объекта → процесс → тип решения; продукты — в списке справа. */
export function CatalogTree({ nodes, params, total, onSelect }: CatalogTreeProps) {
  const path = useMemo(() => selectedPath(nodes, params), [nodes, params]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(nodes[0] ? [nodes[0].key, nodes[0].children[0]?.key ?? ""] : []));

  // Раскрыть путь к выбранному узлу (переход по ссылке или из хлебных крошек).
  useEffect(() => {
    if (path.length) setOpen((current) => new Set([...current, ...path.map((n) => n.key)]));
  }, [path]);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const render = (node: TreeNode, depth: number) => {
    const Icon = KIND_ICON[node.kind];
    const expanded = open.has(node.key);
    const selected = isNodeSelected(node, params);
    return (
      <li key={node.key} role="treeitem" aria-expanded={node.children.length ? expanded : undefined} aria-selected={selected}>
        <div className={cx("tnode", `tnode--${node.kind}`, selected && "is-selected", node.count === 0 && "is-empty")} style={{ paddingLeft: depth * 14 }}>
          {node.children.length > 0 ? (
            <button
              type="button"
              className={cx("tnode__chevron", expanded && "is-open")}
              onClick={() => toggle(node.key)}
              aria-label={expanded ? `Свернуть «${node.name}»` : `Раскрыть «${node.name}»`}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ) : (
            <span className="tnode__spacer" />
          )}
          <button
            type="button"
            className="tnode__label"
            title={KIND_TITLE[node.kind]}
            onClick={() => {
              onSelect(node);
              if (node.children.length && !expanded) toggle(node.key);
            }}
          >
            <Icon size={15} aria-hidden="true" className="tnode__icon" />
            <span className="tnode__name">{node.name}</span>
            <span className="tnode__count">{node.count}</span>
          </button>
        </div>
        {expanded && node.children.length > 0 && (
          <ul role="group">{node.children.map((child) => render(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  const nothingSelected = path.length === 0;
  return (
    <nav className="ctree" aria-label="Иерархия каталога">
      <ul role="tree">
        <li role="treeitem" aria-selected={nothingSelected}>
          <div className={cx("tnode", "tnode--root", nothingSelected && "is-selected")}>
            <span className="tnode__spacer" />
            <button type="button" className="tnode__label" onClick={() => onSelect(null)}>
              <Layers size={15} aria-hidden="true" className="tnode__icon" />
              <span className="tnode__name">Все роботы</span>
              {total !== null && <span className="tnode__count">{total}</span>}
            </button>
          </div>
        </li>
        {nodes.map((node) => render(node, 0))}
      </ul>
    </nav>
  );
}
