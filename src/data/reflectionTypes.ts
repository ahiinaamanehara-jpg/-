import type { QuestionId } from "./reflectionQuestions";

export interface Reflection {
  id: string;
  artworkId: string;
  questionId: QuestionId;
  text: string;
  choice: string | null;
  comparedArtworkId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
