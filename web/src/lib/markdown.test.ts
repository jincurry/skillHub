// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('renders headings', () => {
    expect(renderMarkdown('# Hello')).toContain('<h1>Hello</h1>');
  });

  it('renders fenced code blocks', () => {
    const out = renderMarkdown('```ts\nconst x = 1\n```');
    expect(out).toContain('<pre><code class="language-ts">const x = 1</code></pre>');
  });

  it('escapes HTML in paragraphs', () => {
    const out = renderMarkdown('hello <script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  describe('GFM tables', () => {
    it('renders a basic pipe table', () => {
      const src = [
        '| Name | Role |',
        '| --- | --- |',
        '| alice | admin |',
        '| bob | maintainer |',
      ].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('<table>');
      expect(html).toContain('<thead><tr><th>Name</th><th>Role</th></tr></thead>');
      expect(html).toContain('<tbody>');
      expect(html).toContain('<tr><td>alice</td><td>admin</td></tr>');
      expect(html).toContain('<tr><td>bob</td><td>maintainer</td></tr>');
    });

    it('honours alignment markers', () => {
      const src = [
        '| L | C | R |',
        '| :--- | :---: | ---: |',
        '| 1 | 2 | 3 |',
      ].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('<th style="text-align:left">L</th>');
      expect(html).toContain('<th style="text-align:center">C</th>');
      expect(html).toContain('<th style="text-align:right">R</th>');
      expect(html).toContain('<td style="text-align:left">1</td>');
      expect(html).toContain('<td style="text-align:center">2</td>');
      expect(html).toContain('<td style="text-align:right">3</td>');
    });

    it('renders inline markup inside cells', () => {
      const src = [
        '| Cmd | Note |',
        '| --- | --- |',
        '| `go test` | **runs tests** |',
      ].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('<code>go test</code>');
      expect(html).toContain('<strong>runs tests</strong>');
    });

    it('falls back to paragraph when separator is missing', () => {
      const src = '| not | a | table |\nplain text follows';
      const html = renderMarkdown(src);
      expect(html).not.toContain('<table>');
      expect(html).toContain('<p>');
    });

    it('handles tables without leading/trailing pipes', () => {
      const src = ['a | b', '--- | ---', '1 | 2'].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('<th>a</th><th>b</th>');
      expect(html).toContain('<td>1</td><td>2</td>');
    });

    it('pads short body rows to header column count', () => {
      const src = [
        '| A | B | C |',
        '| --- | --- | --- |',
        '| 1 | 2 |',
      ].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('<tr><td>1</td><td>2</td><td></td></tr>');
    });

    it('stops the table at a blank line', () => {
      const src = [
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        'after',
      ].join('\n');
      const html = renderMarkdown(src);
      expect(html).toContain('</table>');
      expect(html).toContain('<p>after</p>');
    });
  });

  // Regression: shebangs and other `#x` (no whitespace) lines used to be
  // rejected by both the heading parser (which requires \s+ after #) AND the
  // paragraph collector (which excluded any ^#), leaving the outer loop
  // unable to advance — a classic infinite-loop → browser OOM crash.
  describe('lines starting with # but not headings', () => {
    function withTimeout(fn: () => string, ms = 1000): string {
      const start = Date.now();
      const out = fn();
      if (Date.now() - start > ms) throw new Error('renderMarkdown took too long');
      return out;
    }

    it('renders a bash shebang as a paragraph instead of hanging', () => {
      const html = withTimeout(() => renderMarkdown('#!/bin/bash\necho hi'));
      expect(html).toContain('<p>');
      expect(html).toContain('#!/bin/bash');
    });

    it('renders a python shebang as a paragraph instead of hanging', () => {
      const html = withTimeout(() => renderMarkdown('#!/usr/bin/env python3\nprint("hi")'));
      expect(html).toContain('#!/usr/bin/env python3');
    });

    it('still rejects `#hashtag` lines from being headings', () => {
      const html = withTimeout(() => renderMarkdown('#hashtag content'));
      // Not a heading (no space after #), so paragraph-wrapped.
      expect(html).not.toContain('<h1>');
      expect(html).toContain('<p>');
      expect(html).toContain('#hashtag');
    });

    it('still parses real headings', () => {
      expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
      expect(renderMarkdown('### Sub')).toContain('<h3>Sub</h3>');
    });
  });
});
