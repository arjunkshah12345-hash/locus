export type Token = { subject: string; exp: number };

export function verifyToken(token: Token, now: number): boolean {
  return token.subject.length > 0 && token.exp > now;
}
