import { answerNlpQuestion } from "@/app/lib/llm";
import { getCurrentUser } from "@/app/lib/session";

export async function POST(request: Request) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { question?: string };
    const question = body.question?.trim();
    if (!question) {
      return Response.json({ error: "Missing question" }, { status: 400 });
    }
    const result = await answerNlpQuestion(question);
    // result.validationFailed is true when the LLM summary was discarded
    // because it referenced a number/date not present in the retrieved rows;
    // the client shows the deterministic fallback and we log it to nlp_queries
    // for drift monitoring.
    return Response.json(result);
  } catch (error) {
    console.error("NLP query failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
