import { describe, expect, it } from 'vitest';
import { htmlToReadableText } from '@/lib/html-to-readable-text';

describe('htmlToReadableText', () => {
  it('keeps paragraphs and line breaks', () => {
    expect(htmlToReadableText('<p>Hello <b>Ann</b>,</p><p>first line<br>second line</p>'))
      .toBe('Hello Ann,\n\nfirst line\nsecond line');
  });

  it('keeps link targets and image alt text', () => {
    expect(htmlToReadableText('<p>Read <a href="https://ex.com/a">the report</a> <img src="x.png" alt="Logo"></p>'))
      .toBe('Read the report (https://ex.com/a) [Logo]');
  });

  it('does not repeat a target that is the link text, and drops script and style', () => {
    expect(htmlToReadableText('<style>p{color:red}</style><a href="https://ex.com/">ex.com</a><script>x()</script>'))
      .toBe('ex.com');
    expect(htmlToReadableText('<a href="mailto:ann@ex.com?subject=Hi">Write to Ann</a>'))
      .toBe('Write to Ann (ann@ex.com)');
  });

  it('turns layout tables into lines and lists into bullets', () => {
    const html = '<table><tr><td>Name</td><td>Ann</td></tr><tr><td>City</td><td>Berlin</td></tr></table><ul><li>one</li><li>two</li></ul>';
    expect(htmlToReadableText(html)).toBe('Name Ann\nCity Berlin\n\n• one\n• two');
  });

  it('skips hidden preheaders and images without alt text', () => {
    expect(htmlToReadableText('<div style="display:none">preheader</div><img src="t.gif"><p>Body</p>')).toBe('Body');
  });
});
