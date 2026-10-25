interface NextApiReq {
  method?: string;
}

interface NextApiRes {
  status(code: number): { json(body: unknown): void };
}

// Ambiguous Pages Router handler without explicit method dispatch
// Demonstrates that UNDRIFT conservatively reports an UNSUPPORTED_PATTERN limitation
// instead of fabricating hypothetical methods.
export default function handler(req: NextApiReq, res: NextApiRes) {
  res.status(200).json({ message: "Hello from ambiguous handler" });
}
