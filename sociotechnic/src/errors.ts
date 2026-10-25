export class SociotechnicError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SociotechnicError";
    this.code = code;
  }
}

export class IllegalTransition extends SociotechnicError {
  constructor(message: string) {
    super("illegal-transition", message);
    this.name = "IllegalTransition";
  }
}
