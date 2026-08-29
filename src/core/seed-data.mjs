export const categories = [
  { id: "cat_family", name: "Family Fun", active: true },
  { id: "cat_general", name: "General Knowledge", active: true },
  { id: "cat_food", name: "Food", active: true }
];

export const questions = [
  {
    id: "q_001",
    categoryId: "cat_general",
    category: "General Knowledge",
    difficulty: "easy",
    prompt: "Which planet is known as the Red Planet?",
    explanation: "Mars looks red because iron minerals in its soil oxidize.",
    choices: [
      { id: "q_001_a", label: "A", text: "Venus", isCorrect: false },
      { id: "q_001_b", label: "B", text: "Mars", isCorrect: true },
      { id: "q_001_c", label: "C", text: "Jupiter", isCorrect: false },
      { id: "q_001_d", label: "D", text: "Saturn", isCorrect: false }
    ]
  },
  {
    id: "q_002",
    categoryId: "cat_food",
    category: "Food",
    difficulty: "easy",
    prompt: "What fruit is traditionally used in a classic banana split?",
    explanation: "A banana split is named for the banana cut lengthwise around scoops of ice cream.",
    choices: [
      { id: "q_002_a", label: "A", text: "Banana", isCorrect: true },
      { id: "q_002_b", label: "B", text: "Pineapple", isCorrect: false },
      { id: "q_002_c", label: "C", text: "Apple", isCorrect: false },
      { id: "q_002_d", label: "D", text: "Pear", isCorrect: false }
    ]
  },
  {
    id: "q_003",
    categoryId: "cat_family",
    category: "Family Fun",
    difficulty: "medium",
    prompt: "In bowling, how many pins are set up at the start of a frame?",
    explanation: "Ten pins are arranged in a triangle at the end of the lane.",
    choices: [
      { id: "q_003_a", label: "A", text: "8", isCorrect: false },
      { id: "q_003_b", label: "B", text: "9", isCorrect: false },
      { id: "q_003_c", label: "C", text: "10", isCorrect: true },
      { id: "q_003_d", label: "D", text: "12", isCorrect: false }
    ]
  }
];
