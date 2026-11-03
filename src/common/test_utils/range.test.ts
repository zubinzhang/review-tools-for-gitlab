import { Position } from './position';
import { Range } from './range';

describe('Range.contains', () => {
  const range = new Range(10, 2, 12, 4);

  it('matches VS Code position containment including range boundaries', () => {
    expect(range.contains(new Position(10, 1))).toBe(false);
    expect(range.contains(new Position(10, 2))).toBe(true);
    expect(range.contains(new Position(11, 100))).toBe(true);
    expect(range.contains(new Position(12, 4))).toBe(true);
    expect(range.contains(new Position(12, 5))).toBe(false);
  });

  it('requires both endpoints of a nested range to be contained', () => {
    expect(range.contains(new Range(10, 2, 12, 4))).toBe(true);
    expect(range.contains(new Range(11, 0, 12, 2))).toBe(true);
    expect(range.contains(new Range(9, 0, 11, 0))).toBe(false);
    expect(range.contains(new Range(11, 0, 13, 0))).toBe(false);
  });
});
