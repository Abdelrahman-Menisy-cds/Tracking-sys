/**
 * H20 - a tiny, dependency-light renderer for the مدام عفاف replies.
 * H41 - pipe tables (`| النوع | الموافقة |`) arrive as REAL tables now:
 * header + `|---|` separator render one proper `<table>`; pipe rows without
 * a separator fall back to a list, so no reply ever paints raw `|` rows.
 *
 * The model answers in a markdown subset - `**bold**`, `` `code` ``, `-`
 * bullet lists, `1.` numbered lists, pipe tables, and plain line breaks -
 * and until now those markers reached the owner raw («**ساعاتك», «| النوع |»).
 *
 * Safety rule from the brief: the text comes from a model, so nothing here
 * builds HTML. Every token becomes a React element (`<strong>`, `<code>`,
 * `<ul>`, `<ol>`, `<li>`, `<table>`...); there is no `dangerouslySetInnerHTML`,
 * no escaping to second-guess, because React escapes all text nodes itself.
 *
 * Supported, in the order the model actually uses them:
 *   - line breaks inside a paragraph
 *   - `**bold**` and `` `inline code` ``(non-greedy, same line)
 *   - `- item` and `* item` bullets → one `<ul>`
 *   - `1.` `2)` ordered items → one `<ol>`
 *   - consecutive list lines merge into a single list block
 *   - H41: consecutive `| cell | cell |` rows → a `<table>` when the second
 *     row is a `|---|` divider (first row = header), else one list entry per
 *     row with the cells joined by a directional separator
 * Anything else renders as a normal paragraph of escaped text.
 */

import type { ReactNode } from "react";

/** `**bold**` | `` `code` `` | other text runs - one pass, non-greedy. */
const INLINE_RE = /(\*\*[^*]+\*\*)|(`[^`\n]+`)/g;

/** `- item` | `* item` | `1.` item | `12) item` */
const LIST_RE = /^([-*]|\d+[.)])[ \t]+(.+)$/;

/** Inline pass: bold and code within one line, everything else escaped by React. */
function renderInline(text: string): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("**")) {
      // No marker may span a line: `**a\nb**` stays literal on both lines.
      if (token.includes("\n")) {
        nodes.push(token);
      } else {
        nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
      }
    } else {
      nodes.push(<code key={key++} className="assistant-inline-code">{token.slice(1, -1)}</code>);
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** H41 - one pipe row (`| a | b |`) trimmed to its cells. */
function tableCells(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

/** A markdown separator row: `|---|:--:|` */
function isDividerRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** Turn one markdown-subset text into paragraphs, lists and (H41) tables. */
export function renderAssistantMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = (text ?? "").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let tableRows: string[][] | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join("\n");
    blocks.push(
      <p key={key++} className="assistant-md-para">
        {renderInline(joined)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={key++} className="assistant-md-list" dir="auto">
        {list.items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  // H41 - a run of pipe rows renders as a real table when the row after the
  // first is a divider (that row is consumed as the header separator);
  // otherwise each row becomes one list item with the cells joined, never
  // a raw pipe line on screen.
  const flushTable = () => {
    if (!tableRows || tableRows.length === 0) {
      tableRows = null;
      return;
    }
    const [first, second, ...rest] = tableRows;
    if (tableRows.length >= 2 && isDividerRow(second) && !isDividerRow(first)) {
      blocks.push(
        <table key={key++} className="assistant-md-table">
          <thead>
            <tr>{first.map((cell, index) => <th key={index} scope="col">{renderInline(cell)}</th>)}</tr>
          </thead>
          <tbody>
            {rest.map((rowCells, rowIndex) => (
              <tr key={rowIndex}>{rowCells.map((cell, index) => <td key={index}>{renderInline(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else {
      blocks.push(
        <ul key={key++} className="assistant-md-list" dir="auto">
          {tableRows.map((rowCells, index) => (
            <li key={index}>{renderInline(rowCells.join(" · "))}</li>
          ))}
        </ul>,
      );
    }
    tableRows = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    // H41 - a pipe row cannot also be a list item (the list grammar starts
    // with `-`/`*`/digit), so the check order below is safe.
    if (trimmed.startsWith("|") && trimmed.length > 1) {
      flushParagraph();
      if (!tableRows) tableRows = [];
      tableRows.push(tableCells(trimmed));
      continue;
    }
    flushTable();
    const listItem = LIST_RE.exec(trimmed);
    if (listItem) {
      flushParagraph();
      const ordered = /\d/.test(listItem[1]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(listItem[2]);
      continue;
    }
    flushList();
    if (trimmed === "") {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushTable();
  flushList();
  flushParagraph();
  return blocks;
}
