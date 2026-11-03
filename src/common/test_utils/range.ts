import { Position } from './position';

export class Range {
  readonly start: Position;

  readonly end: Position;

  constructor(start: Position, end: Position);

  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);

  constructor(
    startOrLine: Position | number,
    endOrCharacter: Position | number,
    endLine?: number,
    endCharacter?: number,
  ) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrCharacter as number);
      this.end = new Position(endLine as number, endCharacter as number);
    } else {
      this.start = startOrLine;
      this.end = endOrCharacter as Position;
    }
  }

  isEqual(other: Range) {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  contains(value: Position | Range) {
    const start = value instanceof Range ? value.start : value;
    const end = value instanceof Range ? value.end : value;
    return this.start.compareTo(start) <= 0 && this.end.compareTo(end) >= 0;
  }

  get isEmpty() {
    return this.start.isEqual(this.end);
  }
}
