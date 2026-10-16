/**
 * H20 - a tiny, dependency-light renderer for the مدام عفاف replies.
 *
 * The model answers in a markdown subset - `**bold**`, `` `code` ``, `-`
 * bullet lists, `1.` numbered lists, and plain line breaks - and until now
 * those markers reached the owner raw («**ساعاتك», «**رقم نوع الطلب»).
 *
 * Safety rule from the brief: the text comes from a model, so nothing here
 * builds HTML. Every token becomes a React element (`<strong>`, `<code>`,
 * `<ul>`, `<ol>`, `<li>`, `<p>`); there is no `dangerouslySetInnerHTML`, no
 * escaping to second-guess, because React escapes all text nodes itself.
 *
 * Supported, in the order the model actually uses them:
 *   - line breaks inside a paragraph
 *   - `**bold**` and `` `inline code` ``(non-greedy, same line)
 *   - `- item` and `* item` bullets → one `<ul>`
 *   - `1.` `2)` ordered items → one `<ol>`
 *   - consecutive list lines merge into a single list block
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

/** Turn one markdown-subset text into paragraphs and list elements. */
export function renderAssistantMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = (text ?? "").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
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

  for (const raw of lines) {
    const line = raw.trimEnd();
    const listItem = LIST_RE.exec(line.trim());
    if (listItem) {
      flushParagraph();
      const ordered = /\d/.test(listItem[1]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(listItem[2]);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushList();
  flushParagraph();
  return blocks;
}
