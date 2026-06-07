import { GoogleGenAI, Type } from "@google/genai";
import { RubricItem } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export const ocrAndSegment = async (base64Images: string[]) => {
  const model = "gemini-3-flash-preview";
  
  const contentParts = [
    { text: "You are an expert OCR and exam evaluation helper. Analyze the following images of an exam answer sheet. Extract all question-answer pairs. For each pair, provide the question number, the question text (if visible or inferred), and the student's written answer. Also, detect if the student's answer is primarily handwriting (isHandwritten: true) or printed/digital (isHandwritten: false). Output the data as a JSON array of objects." },
    ...base64Images.map(img => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: img.split(',')[1] || img
      }
    }))
  ];

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts: contentParts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionNumber: { type: Type.STRING },
              questionText: { type: Type.STRING },
              studentAnswer: { type: Type.STRING },
              isHandwritten: { type: Type.BOOLEAN }
            },
            required: ["questionNumber", "studentAnswer", "isHandwritten"]
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error: any) {
    if (error?.message?.includes("429") || error?.status === 429) {
      throw new Error("Gemini AI API quota exceeded. Please wait a moment or try again later. Free tier limits are usually reset every minute or hour.");
    }
    throw error;
  }
};

export const generateRubric = async (input: { content?: string, images?: string[], studentLevel: string, totalPoints?: number }) => {
  const model = "gemini-3-flash-preview";
  
  const contentParts: any[] = [
    { text: `You are an expert curriculum designer. Based on the following question paper content (or images) and the target student level, generate a structured grading rubric.
    
    Student Level: ${input.studentLevel}
    Suggested Total Points: ${input.totalPoints || "As appropriate for the level"}
    
    Instructions:
    1. Identify distinct questions and scan for EXAM SECTIONS (e.g. "Section A", "Part 1").
    2. LOOK FOR MARKS: Pay extreme attention to text like "[1]", "(2 marks)", or "Q1... 6 marks". These MUST define the maxScore for those items.
    3. DETECT CONSTRAINTS: Look for instructions like "Attempt any 4", "Compulsory", or "Section A: 6 questions, all to be attempted".
    4. For each section, provide: title, the question numbers (IDs) it contains, and the number of questions a student MUST attempt. 
    5. If a section is compulsory, questionsToAttempt MUST equal the total number of questions in that section.
    6. For each individual question, create a Rubric Item with the specific maxScore detected in the text. Do not aggregate multiple 1-mark questions into one high-mark item unless they are clearly one single task.` }
  ];

  if (input.content) {
    contentParts.push({ text: `Question Paper Text Content: ${input.content}` });
  }

  if (input.images && input.images.length > 0) {
    input.images.forEach(img => {
      contentParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: img.split(",")[1] || img
        }
      });
    });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: contentParts,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.STRING },
                  questionText: { type: Type.STRING },
                  maxScore: { type: Type.NUMBER },
                  exemplaryResponse: { type: Type.STRING },
                  criteria: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        description: { type: Type.STRING },
                        points: { type: Type.NUMBER }
                      },
                      required: ["label", "description", "points"]
                    }
                  }
                },
                required: ["questionNumber", "questionText", "maxScore", "criteria", "exemplaryResponse"]
              }
            },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  questionsToAttempt: { type: Type.NUMBER },
                  questionNumbers: { type: Type.ARRAY, items: { type: Type.STRING } },
                  maxMarksPerQuestion: { type: Type.NUMBER }
                },
                required: ["title", "questionsToAttempt", "questionNumbers"]
              }
            }
          },
          required: ["items"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      items: parsed.items as RubricItem[],
      sections: (parsed.sections || []).map((s: any) => ({ ...s, id: Math.random().toString(36).substring(7) }))
    };
  } catch (error: any) {
    if (error?.message?.includes("429") || error?.status === 429) {
      throw new Error("Gemini AI API quota exceeded during rubric generation. Please wait a moment.");
    }
    throw error;
  }
};

export const evaluateAnswer = async (question: string, modelAnswer: string | undefined, studentAnswer: string, rubric?: RubricItem | RubricItem[]) => {
  const model = "gemini-3-flash-preview";

  const rubrics = Array.isArray(rubric) ? rubric : (rubric ? [rubric] : []);
  const totalMax = rubrics.length > 0 ? rubrics.reduce((acc, r) => acc + r.maxScore, 0) : 10;

  let prompt = `
    You are an expert impartial examiner. Your task is to evaluate a student's answer against a specific question and the provided rubric(s).
    
    ### CONTEXT
    Question Reference: "${question}"
    Student's Answer: "${studentAnswer}"
  `;

  if (rubrics.length > 0) {
    prompt += `
    ### GRADING RUBRICS (Strict Adherence Required)
    Total Maximum Score: ${totalMax}

    ${rubrics.map((r, idx) => `
    Rubric Item ${idx + 1} (${r.questionNumber}):
    - Exemplary Response: ${r.exemplaryResponse}
    - Max Score: ${r.maxScore}
    - Scoring Levels:
    ${r.criteria.map(c => `  * [${c.points} points]: ${c.label} - ${c.description}`).join('\n')}
    `).join('\n')}
    
    ### INSTRUCTIONS
    1. Evaluate the student answer against ALL applicable rubric items above.
    2. For each rubric item, assign EXACTLY one of the point values defined in its scoring levels.
    3. DO NOT use intermediate, fractional, or range-based scores.
    4. The final "score" MUST be the SUM of scores from the rubrics above.
    5. CRITICAL: The total score MUST NOT exceed ${totalMax}. If the answer is completely correct, give ${totalMax}. If it is incorrect, give 0.
    6. Feedback must justify the score based on the specific criteria met.
    `;
  } else {
    prompt += `
    Model Answer Context: "${modelAnswer || "Not provided."}"
    
    ### INSTRUCTIONS
    1. Evaluate the answer for correctness, completeness, and clarity.
    2. Provide a score out of 10.
    3. Provide constructive feedback.
    `;
  }

  prompt += `
    Output your evaluation in JSON format with "score", "confidence", and "feedback" fields.
    
    ### JSON SCHEMA REQUIREMENT
    The "score" field must be a number between 0 and ${totalMax}.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: `Score from 0 to ${totalMax}. MUST NOT EXCEED ${totalMax}.` },
            confidence: { type: Type.NUMBER },
            feedback: { type: Type.STRING }
          },
          required: ["score", "confidence", "feedback"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const finalScore = Math.min(Number(parsed.score) || 0, totalMax);
    
    return {
      score: finalScore,
      confidence: Number(parsed.confidence) || 0.5,
      feedback: String(parsed.feedback || "Evaluated based on criteria.")
    };
  } catch (error: any) {
    if (error?.message?.includes("429") || error?.status === 429) {
      throw new Error("Gemini AI API quota exceeded during evaluation. Please wait a bit.");
    }
    throw error;
  }
};
