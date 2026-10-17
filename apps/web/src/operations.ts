export class ProjectScope {
  private epoch = 0;
  constructor(private id: string) {}
  capture() {
    return { id: this.id, epoch: this.epoch };
  }
  switchTo(id: string) {
    this.id = id;
    this.epoch++;
  }
  isCurrent(token: { id: string; epoch: number }) {
    return token.id === this.id && token.epoch === this.epoch;
  }
}
