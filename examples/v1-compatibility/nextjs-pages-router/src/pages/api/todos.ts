interface NextApiReq {
  method?: string;
}

interface NextApiRes {
  status(code: number): {
    json(body: unknown): void;
    end(message?: string): void;
  };
  setHeader(name: string, value: string | string[]): void;
}

// Supported Pages Router handler pattern using switch (req.method)
export default function handler(req: NextApiReq, res: NextApiRes) {
  switch (req.method) {
    // Deliberate mismatch: consumer called POST /api/todos, provider implements PUT
    case "PUT":
      return res.status(200).json({ updated: true });
    default:
      res.setHeader("Allow", ["PUT"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
