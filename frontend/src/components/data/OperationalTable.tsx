import type { ReactNode } from "react";

export type OperationalColumn<T> = { key: string; label: string; render: (record: T) => ReactNode; header?: ReactNode };
export default function OperationalTable<T extends { id: string }>({ caption, columns, records }: { caption: string; columns: OperationalColumn<T>[]; records: T[] }) {
  return <><div className="table-wrap"><table><caption className="table-caption">{caption}</caption><thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.header ?? column.label}</th>)}</tr></thead><tbody>{records.map((record) => <tr key={record.id}>{columns.map((column, index) => index === 0 ? <th scope="row" key={column.key}>{column.render(record)}</th> : <td key={column.key}>{column.render(record)}</td>)}</tr>)}</tbody></table></div><div className="mobile-record-list" aria-label={caption}>{records.map((record) => <article className="record-block" key={record.id}>{columns.map((column) => <div className="record-field" key={column.key}><span className="record-field-label">{column.label}</span><span>{column.render(record)}</span></div>)}</article>)}</div></>;
}
