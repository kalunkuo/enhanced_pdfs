import { useMemo, type ReactNode } from 'react';
import { parseMarkdown, type MdBlock, type MdInline } from '../../lib/markdown';

function renderInline(nodes: MdInline[]): ReactNode[] {
    return nodes.map((node, index) => {
        switch (node.type) {
            case 'text': return node.text;
            case 'br': return <br key={index} />;
            case 'code': return <code key={index}>{node.text}</code>;
            case 'strong': return <strong key={index}>{renderInline(node.children)}</strong>;
            case 'em': return <em key={index}>{renderInline(node.children)}</em>;
            case 'del': return <del key={index}>{renderInline(node.children)}</del>;
            case 'link': return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">{renderInline(node.children)}</a>;
        }
    });
}

function renderBlocks(blocks: MdBlock[]): ReactNode[] {
    return blocks.map((block, index) => {
        switch (block.type) {
            case 'paragraph': return <p key={index}>{renderInline(block.children)}</p>;
            case 'heading': {
                // The panel already uses h2; reply headings start one level below it.
                const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[Math.min(block.level, 4) - 1]!;
                return <Tag key={index} className="agent-md-heading">{renderInline(block.children)}</Tag>;
            }
            case 'list': {
                const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderBlocks(item)}</li>);
                return block.ordered ? <ol key={index} start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
            }
            case 'code': return <pre key={index}><code data-lang={block.lang || undefined}>{block.text}</code></pre>;
            case 'quote': return <blockquote key={index}>{renderBlocks(block.children)}</blockquote>;
            case 'rule': return <hr key={index} />;
            case 'table': return <div key={index} className="agent-md-table" tabIndex={0} role="region" aria-label="Table">
                <table>
                    <thead><tr>{block.header.map((cell, column) => <th key={column} style={block.align[column] ? { textAlign: block.align[column] } : undefined}>{renderInline(cell)}</th>)}</tr></thead>
                    <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={block.align[column] ? { textAlign: block.align[column] } : undefined}>{renderInline(cell)}</td>)}</tr>)}</tbody>
                </table>
            </div>;
        }
    });
}

/** Renders an agent reply's Markdown as React elements; raw HTML in the text stays literal. */
export function AgentMarkdown({ text }: { text: string }) {
    const blocks = useMemo(() => parseMarkdown(text), [text]);
    return <div className="agent-markdown">{renderBlocks(blocks)}</div>;
}
