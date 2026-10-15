import { describe, expect, it } from 'vitest';
import { checkImportTarget, parseJsonText } from '../files';
import { readJsonFile, readTextFile } from '../../state/persistence';
import { parsePolyhedronFile } from '../polyhedron';
import { POLYHEDRON_EXAMPLE_JSON, POLYHEDRON_EXAMPLE_TXT } from '../examples';
import { parseStyleJson } from '../../state/interchange';

describe('readable import failures before state application', () => {
  it.each(['null', '[]', '42', 'true', '"name"'])('rejects non-object JSON %s', source => {
    expect(() => parseJsonText(source)).toThrow(/JSON object/);
  });
  it.each(['', '   ', '\uFEFF\n'])('explains empty files', source => {
    expect(() => parseJsonText(source)).toThrow(/empty/);
  });
  it('explains syntax and accepts BOM without exposing raw parser errors', () => {
    expect(() => parseJsonText('{"secret":')).toThrow(/not valid JSON/);
    expect(parseJsonText('\uFEFF{"ok":true}')).toEqual({ok:true});
  });
  it('gives the correct command for the wrong file type', () => {
    expect(() => checkImportTarget({format:'curvature-studio/polyhedron'}, 'workspace')).toThrow(/Templates → Import polyhedron/);
    expect(() => checkImportTarget({format:'curvature-studio/workspace'}, 'project')).toThrow(/open both structures/);
    expect(() => checkImportTarget({format:'curvature-studio/style'}, 'workspace')).toThrow(/Import style/);
    expect(() => checkImportTarget({format:'toString'}, 'project')).toThrow(/not a supported/);
  });
  it('checks byte limits before reading and explains unavailable files', async () => {
    let read = false;
    await expect(readTextFile({size:9, text:async()=>{read=true;return '{}';}} as unknown as File, 8)).rejects.toThrow(/exceeds/);
    expect(read).toBe(false);
    await expect(readJsonFile({size:1, text:async()=>{throw new Error('device gone');}} as unknown as File)).rejects.toThrow(/available on this device/);
  });
  it('rejects empty and malformed polyhedron inputs rather than silently dropping faces', () => {
    expect(() => parsePolyhedronFile('', 'empty.txt')).toThrow(/empty/);
    expect(() => parsePolyhedronFile('null', 'null.json')).toThrow(/JSON object/);
    expect(() => parsePolyhedronFile('{', 'bad.json')).toThrow(/not valid JSON/);
    expect(() => parsePolyhedronFile('solid ascii stl', 'mesh.stl')).toThrow(/Unsupported polyhedron text/);
    expect(() => parsePolyhedronFile(POLYHEDRON_EXAMPLE_TXT + '\n{0, broken, 2}', 'bad.txt')).toThrow(/Invalid face on line/);
    expect(() => parsePolyhedronFile(POLYHEDRON_EXAMPLE_TXT.replace('V0 =', 'V0 broken ='), 'bad.txt')).toThrow(/Invalid polyhedron declaration/);
  });
  it('still imports both published JSON/TXT examples, including a BOM', () => {
    const json=parsePolyhedronFile('\uFEFF'+POLYHEDRON_EXAMPLE_JSON,'example.json');
    const txt=parsePolyhedronFile('\uFEFF'+POLYHEDRON_EXAMPLE_TXT,'example.txt');
    expect(parsePolyhedronFile(POLYHEDRON_EXAMPLE_TXT.split('\n').map(line => '  '+line).join('\n'), 'indented.txt').edges).toEqual(json.edges);
    expect(json.edges).toEqual(txt.edges); expect(json.vertices3d).toEqual(txt.vertices3d);
  });
  it('does not turn an array in a style file into default settings', () => {
    expect(() => parseStyleJson({format:'curvature-studio/style',version:2,style:[],customGradients:[]})).toThrow(/Style file/);
  });
});
