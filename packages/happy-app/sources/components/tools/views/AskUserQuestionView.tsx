import * as React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ToolViewProps } from "./_all";
import { ToolSectionView } from "../ToolSectionView";
import {
  sessionAllow,
  sessionAskUserResponse,
  sessionInterrupt,
} from "@/sync/ops";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface AskUserQuestionInput {
  questions: Question[];
}

/**
 * Parse "(Recommended)" suffix from option label.
 * Returns the cleaned label and whether it was recommended.
 */
function parseRecommended(label: string): {
  cleanLabel: string;
  isRecommended: boolean;
} {
  const match = label.match(/^(.+?)\s*\(Recommended\)\s*$/i);
  if (match) {
    return { cleanLabel: match[1].trim(), isRecommended: true };
  }
  return { cleanLabel: label, isRecommended: false };
}

/**
 * Get the selected labels for a question (for submitted display).
 */
function getSelectedLabels(
  question: Question,
  selected: Set<number> | undefined,
  otherTexts: Map<number, string>,
  qIndex: number,
): string {
  if (!selected || selected.size === 0) return "-";
  const otherIndex = question.options.length;
  return Array.from(selected)
    .map((optIndex) => {
      if (optIndex === otherIndex) {
        return otherTexts.get(qIndex) || t("tools.askUserQuestion.other");
      }
      return question.options[optIndex]?.label;
    })
    .filter(Boolean)
    .join(", ");
}

// ─── Step Indicator ──────────────────────────────────────────────────

const StepIndicator = React.memo<{
  questions: Question[];
  selections: Map<number, Set<number>>;
  activeIndex: number;
  onStepPress: (index: number) => void;
}>(({ questions, selections, activeIndex, onStepPress }) => {
  const { theme } = useUnistyles();
  if (questions.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.stepRow}
      contentContainerStyle={styles.stepRowContent}
    >
      {questions.map((q, idx) => {
        const hasAnswer = (selections.get(idx)?.size ?? 0) > 0;
        const isActive = idx === activeIndex;

        return (
          <TouchableOpacity
            key={idx}
            style={[
              styles.stepChip,
              isActive && styles.stepChipFocused,
              hasAnswer && !isActive && styles.stepChipDone,
            ]}
            onPress={() => onStepPress(idx)}
            activeOpacity={0.7}
          >
            {hasAnswer ? (
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={theme.colors.radio.active}
              />
            ) : (
              <View
                style={[styles.stepDot, isActive && styles.stepDotFocused]}
              />
            )}
            <Text
              style={[styles.stepLabel, isActive && styles.stepLabelFocused]}
              numberOfLines={1}
            >
              {q.header}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
});

// ─── Option Row ──────────────────────────────────────────────────────

const OptionRow = React.memo<{
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  disabled: boolean;
  onPress: () => void;
}>(({ option, isSelected, multiSelect, disabled, onPress }) => {
  const { cleanLabel, isRecommended } = parseRecommended(option.label);

  return (
    <TouchableOpacity
      style={[
        styles.optionButton,
        isSelected && styles.optionButtonSelected,
        disabled && styles.optionButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {multiSelect ? (
        <View
          style={[
            styles.checkboxOuter,
            isSelected && styles.checkboxOuterSelected,
          ]}
        >
          {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
      ) : (
        <View
          style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}
        >
          {isSelected && <View style={styles.radioInner} />}
        </View>
      )}
      <View style={styles.optionContent}>
        <View style={styles.optionLabelRow}>
          <Text style={styles.optionLabel}>{cleanLabel}</Text>
          {isRecommended && (
            <View style={styles.recommendedTag}>
              <Text style={styles.recommendedText}>
                {t("tools.askUserQuestion.recommended")}
              </Text>
            </View>
          )}
        </View>
        {option.description ? (
          <Text style={styles.optionDescription}>{option.description}</Text>
        ) : null}
        {option.preview ? (
          <Text style={styles.optionPreview}>{option.preview}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

// ─── Submitted View ──────────────────────────────────────────────────

/**
 * Find the description of the selected option by matching the answer label.
 */
function getSelectedDescription(
  question: Question,
  answerLabel: string,
): string | undefined {
  // Try exact match first, then match individual labels for multi-select
  const labels = answerLabel.split(", ");
  const descriptions: string[] = [];
  for (const lbl of labels) {
    const opt = question.options.find((o) => {
      const { cleanLabel } = parseRecommended(o.label);
      return cleanLabel === lbl || o.label === lbl;
    });
    if (opt?.description) {
      descriptions.push(opt.description);
    }
  }
  return descriptions.length > 0 ? descriptions.join("; ") : undefined;
}

const SubmittedView = React.memo<{
  questions: Question[];
  selections: Map<number, Set<number>>;
  otherTexts: Map<number, string>;
  permissionAnswers?: Record<string, string>;
}>(({ questions, selections, otherTexts, permissionAnswers }) => {
  const { theme } = useUnistyles();
  return (
    <ToolSectionView>
      <View style={styles.submittedContainer}>
        {questions.map((q, qIndex) => {
          // Prefer server-persisted answers (survives re-mount) over local state
          const label =
            permissionAnswers?.[q.question] ||
            getSelectedLabels(q, selections.get(qIndex), otherTexts, qIndex);
          const description = getSelectedDescription(q, label);
          return (
            <View key={qIndex} style={styles.submittedCard}>
              <View style={styles.submittedCardHeader}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={theme.colors.radio.active}
                />
                <Text style={styles.submittedHeader}>{q.header}</Text>
              </View>
              <Text style={styles.submittedQuestion}>{q.question}</Text>
              <View style={styles.submittedAnswer}>
                <Text style={styles.submittedValue}>{label}</Text>
                {description && (
                  <Text style={styles.submittedDescription}>{description}</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </ToolSectionView>
  );
});

// ─── Main Component ──────────────────────────────────────────────────

export const AskUserQuestionView = React.memo<ToolViewProps>(
  ({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    const [selections, setSelections] = React.useState<
      Map<number, Set<number>>
    >(new Map());
    const selectionsRef = React.useRef(selections);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState(false);
    const [otherTexts, setOtherTexts] = React.useState<Map<number, string>>(
      new Map(),
    );
    const [activeStep, setActiveStep] = React.useState(0);
    React.useEffect(() => {
      selectionsRef.current = selections;
    }, [selections]);
    // Parse input
    const input = tool.input as AskUserQuestionInput | undefined;
    const questions = input?.questions;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return null;
    }

    // Derive interaction state from permission status instead of local state.
    // This fixes re-mount issues and cross-device sync (the old isSubmitted
    // was purely local and would reset on navigation).
    const isRunning = tool.state === "running";
    const isAnswered =
      tool.permission != null && tool.permission.status !== "pending";
    const canInteract = isRunning && !isAnswered && !isSubmitting;

    // Check if all questions have at least one selection
    const allQuestionsAnswered = questions.every((q, qIndex) => {
      const selected = selections.get(qIndex);
      if (!selected || selected.size === 0) return false;
      const otherIndex = q.options.length;
      if (selected.has(otherIndex)) {
        const text = otherTexts.get(qIndex);
        return !!text && text.trim().length > 0;
      }
      return true;
    });

    const handleOptionToggle = React.useCallback(
      (questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        if (!canInteract) return;

        setSelections((prev) => {
          const newMap = new Map(prev);
          const currentSet = newMap.get(questionIndex) || new Set();

          if (multiSelect) {
            const newSet = new Set(currentSet);
            if (newSet.has(optionIndex)) {
              newSet.delete(optionIndex);
            } else {
              newSet.add(optionIndex);
            }
            newMap.set(questionIndex, newSet);
          } else {
            newMap.set(questionIndex, new Set([optionIndex]));

            // Auto-advance to next unanswered question for single-select,
            // but skip when "Other" is selected (user needs to type custom text)
            const isOtherOption =
              optionIndex === questions[questionIndex].options.length;
            if (
              !isOtherOption &&
              questions &&
              questionIndex < questions.length - 1
            ) {
              const nextUnanswered = questions.findIndex(
                (_, i) => i > questionIndex && (newMap.get(i)?.size ?? 0) === 0,
              );
              if (nextUnanswered >= 0) {
                // Defer to avoid state update during render
                setTimeout(() => setActiveStep(nextUnanswered), 200);
              }
            }
          }

          selectionsRef.current = newMap;
          return newMap;
        });
      },
      [canInteract, questions],
    );

    const handleSubmit = React.useCallback(async () => {
      const currentSelections = selectionsRef.current;
      const isAnsweredNow = questions.every((q, qIndex) => {
        const selected = currentSelections.get(qIndex);
        if (!selected || selected.size === 0) return false;
        const otherIndex = q.options.length;
        if (selected.has(otherIndex)) {
          const text = otherTexts.get(qIndex);
          return !!text && text.trim().length > 0;
        }
        return true;
      });
      if (!sessionId || !isAnsweredNow || isSubmitting) return;

      setIsSubmitting(true);
      setSubmitError(false);

      // Build answers as Record<string, string> keyed by question text
      // This matches the AskUserQuestion tool's `answers` parameter schema
      const answers: Record<string, string> = {};
      questions.forEach((q, qIndex) => {
        const selected = currentSelections.get(qIndex);
        if (selected && selected.size > 0) {
          const otherIndex = q.options.length;
          const selectedLabels = Array.from(selected)
            .map((optIndex) => {
              if (optIndex === otherIndex) {
                return otherTexts.get(qIndex) || "";
              }
              return q.options[optIndex]?.label;
            })
            .filter(Boolean)
            .join(", ");
          answers[q.question] = selectedLabels;
        }
      });

      // tool.permission?.id and tool.id are the same value (SDK tool_use_id).
      // Fall back to tool.id when permission hasn't arrived yet due to
      // agentState/tool_use event ordering.
      const permissionId = tool.permission?.id ?? tool.id;
      if (!permissionId) {
        setSubmitError(true);
        setIsSubmitting(false);
        return;
      }

      // Native AskUserQuestion (SDK mode) rides the standard permission RPC.
      // `mcp__happy__ask_user` (PTY mode, registered by happy-cli's Happy MCP
      // server) uses a dedicated `ask_user_response` RPC instead — see
      // sessionAskUserResponse for the rationale.
      const isMcpAskUser = tool.name === "mcp__happy__ask_user";

      try {
        if (isMcpAskUser) {
          await sessionAskUserResponse(sessionId, permissionId, answers);
        } else {
          await sessionAllow(
            sessionId,
            permissionId,
            undefined,
            undefined,
            undefined,
            answers,
          );
        }
      } catch {
        setSubmitError(true);
      } finally {
        setIsSubmitting(false);
      }
    }, [
      sessionId,
      questions,
      otherTexts,
      isSubmitting,
      tool.name,
      tool.permission?.id,
      tool.id,
    ]);

    // Escape hatch for PTY-mode sessions: the CLI's PTY launcher disables
    // AskUserQuestion (see packages/happy-cli/src/claude/claudeRemote.ts) but
    // older CLI builds — or pre-Tier-A sessions already in flight — can still
    // emit a tool_use that nothing on the CLI side will ever resolve. When
    // submit fails or the permission record never arrives, this lets the user
    // send Ctrl-C through the PTY (sessionInterrupt → controller.interrupt)
    // so Claude TUI exits its in-terminal Q&A UI and the session unblocks.
    // Surfaced only on the submit-error path so normal sessions never see it.
    const [isCancelling, setIsCancelling] = React.useState(false);
    const handleCancelStuck = React.useCallback(async () => {
      if (!sessionId || isCancelling) return;
      setIsCancelling(true);
      try {
        await sessionInterrupt(sessionId);
      } catch {
        // sessionInterrupt is a fire-and-forget; surfacing a retry would
        // require its own UX and the user can simply tap again.
      } finally {
        setIsCancelling(false);
      }
    }, [sessionId, isCancelling]);

    // "Decline to answer" path for `mcp__happy__ask_user`. Unlike the stuck
    // escape hatch above, this is a normal user choice — and it's a
    // whole-prompt decision, not a per-step one, so the button is rendered
    // alongside the back/next navigation on every step (not only the last).
    // Used to sit inside the last-step branch which made it invisible in
    // multi-step prompts until the user finished navigating to the end —
    // confusing because "decline" is exactly what you'd want to do at any
    // earlier step too.
    //
    // We POST `canceled: true` so happy-cli's RPC handler rejects the
    // pending MCP promise, which surfaces to Claude TUI as isError and the
    // model picks a fallback path. Native AskUserQuestion (SDK mode) has no
    // equivalent decline channel today, so the button is gated to the MCP
    // variant.
    const isMcpAskUser = tool.name === "mcp__happy__ask_user";
    const [isDeclining, setIsDeclining] = React.useState(false);
    const handleDecline = React.useCallback(async () => {
      if (!sessionId || isDeclining || isSubmitting) return;
      const permissionId = tool.permission?.id ?? tool.id;
      if (!permissionId) return;
      setIsDeclining(true);
      setSubmitError(false);
      try {
        await sessionAskUserResponse(sessionId, permissionId, {}, {
          canceled: true,
        });
      } catch {
        setSubmitError(true);
      } finally {
        setIsDeclining(false);
      }
    }, [
      sessionId,
      isDeclining,
      isSubmitting,
      tool.permission?.id,
      tool.id,
    ]);

    // Show submitted/completed state
    if (isAnswered || tool.state === "completed") {
      return (
        <SubmittedView
          questions={questions}
          selections={selections}
          otherTexts={otherTexts}
          permissionAnswers={tool.permission?.answers}
        />
      );
    }

    // Clamp activeStep to valid range
    const currentStep = Math.min(activeStep, questions.length - 1);
    const question = questions[currentStep];
    const selectedOptions = selections.get(currentStep) || new Set();

    return (
      <ToolSectionView>
        <View style={styles.container}>
          {/* Step progress indicator for multi-question (clickable tabs) */}
          <StepIndicator
            questions={questions}
            selections={selections}
            activeIndex={currentStep}
            onStepPress={setActiveStep}
          />

          {/* Show only the current question */}
          <View style={styles.questionSection}>
            {/* Show header chip for single question */}
            {questions.length === 1 && (
              <View style={styles.headerChip}>
                <Text style={styles.headerText}>{question.header}</Text>
              </View>
            )}
            <Text style={styles.questionText}>{question.question}</Text>
            <View style={styles.optionsContainer}>
              {question.options.map((option, oIndex) => (
                <OptionRow
                  key={oIndex}
                  option={option}
                  isSelected={selectedOptions.has(oIndex)}
                  multiSelect={question.multiSelect}
                  disabled={!canInteract}
                  onPress={() =>
                    handleOptionToggle(
                      currentStep,
                      oIndex,
                      question.multiSelect,
                    )
                  }
                />
              ))}

              {/* "Other" option for custom text input */}
              {(() => {
                const otherIndex = question.options.length;
                const isOtherSelected = selectedOptions.has(otherIndex);
                return (
                  <>
                    <TouchableOpacity
                      key="other"
                      style={[
                        styles.optionButton,
                        isOtherSelected && styles.optionButtonSelected,
                        !canInteract && styles.optionButtonDisabled,
                      ]}
                      onPress={() =>
                        handleOptionToggle(
                          currentStep,
                          otherIndex,
                          question.multiSelect,
                        )
                      }
                      disabled={!canInteract}
                      activeOpacity={0.7}
                    >
                      {question.multiSelect ? (
                        <View
                          style={[
                            styles.checkboxOuter,
                            isOtherSelected && styles.checkboxOuterSelected,
                          ]}
                        >
                          {isOtherSelected && (
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          )}
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.radioOuter,
                            isOtherSelected && styles.radioOuterSelected,
                          ]}
                        >
                          {isOtherSelected && (
                            <View style={styles.radioInner} />
                          )}
                        </View>
                      )}
                      <View style={styles.optionContent}>
                        <Text style={styles.optionLabel}>
                          {t("tools.askUserQuestion.other")}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {isOtherSelected && canInteract && (
                      <TextInput
                        style={styles.otherInput}
                        value={otherTexts.get(currentStep) || ""}
                        onChangeText={(text) =>
                          setOtherTexts((prev) => {
                            const next = new Map(prev);
                            next.set(currentStep, text);
                            return next;
                          })
                        }
                        placeholder={t(
                          "tools.askUserQuestion.otherPlaceholder",
                        )}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        editable={canInteract}
                      />
                    )}
                  </>
                );
              })()}
            </View>
          </View>

          {/* Submit error escape hatch — only shown after a real submit
              attempt failed. See handleCancelStuck for the rationale. */}
          {canInteract && submitError && (
            <View style={styles.cancelHintContainer}>
              <Text style={styles.cancelHintText}>
                {t("tools.askUserQuestion.cancelStuckHint")}
              </Text>
              <TouchableOpacity
                onPress={handleCancelStuck}
                disabled={isCancelling}
                activeOpacity={0.7}
                style={styles.cancelHintButton}
              >
                {isCancelling ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textSecondary}
                  />
                ) : (
                  <Text style={styles.cancelHintButtonText}>
                    {t("tools.askUserQuestion.cancelStuckAction")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Navigation + Decline + Submit
              Layout: [← Back] [Decline]  ...spacer...  [Next →] or [Submit]
              Decline sits on the left side because it's a global "abandon
              this prompt" action — it must be reachable at every step, not
              gated behind navigating to the last one. */}
          {canInteract && (
            <View style={styles.actionsContainer}>
              {questions.length > 1 && currentStep > 0 && (
                <TouchableOpacity
                  style={styles.navButton}
                  onPress={() => setActiveStep(currentStep - 1)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={theme.colors.text}
                  />
                </TouchableOpacity>
              )}
              {isMcpAskUser && (
                <TouchableOpacity
                  style={[
                    styles.declineButton,
                    (isSubmitting || isDeclining) &&
                      styles.declineButtonDisabled,
                  ]}
                  onPress={handleDecline}
                  disabled={isSubmitting || isDeclining}
                  activeOpacity={0.7}
                >
                  {isDeclining ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.textSecondary}
                    />
                  ) : (
                    <Text style={styles.declineButtonText}>
                      {t("tools.askUserQuestion.decline")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              <View style={styles.actionsSpacer} />
              {questions.length > 1 && currentStep < questions.length - 1 ? (
                <TouchableOpacity
                  style={[
                    styles.nextButton,
                    !selectedOptions.size && styles.submitButtonDisabled,
                  ]}
                  onPress={() => setActiveStep(currentStep + 1)}
                  disabled={!selectedOptions.size}
                  activeOpacity={0.7}
                >
                  <Text style={styles.nextButtonText}>
                    {question.header
                      ? questions[currentStep + 1]?.header || ""
                      : ""}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.colors.button.primary.tint}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    (!allQuestionsAnswered || isSubmitting || isDeclining) &&
                      styles.submitButtonDisabled,
                    submitError && styles.submitButtonError,
                  ]}
                  onPress={handleSubmit}
                  disabled={
                    !allQuestionsAnswered || isSubmitting || isDeclining
                  }
                  activeOpacity={0.7}
                >
                  {isSubmitting ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.button.primary.tint}
                    />
                  ) : submitError ? (
                    <>
                      <Ionicons
                        name="refresh"
                        size={14}
                        color={theme.colors.button.primary.tint}
                      />
                      <Text style={styles.submitButtonText}>
                        {t("tools.askUserQuestion.submitRetry")}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {t("tools.askUserQuestion.submit")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ToolSectionView>
    );
  },
);

// ─── Styles ──────────────────────────────────────────────────────────
// Styles MUST be defined outside the component to prevent infinite re-renders
// with react-native-unistyles. The theme is passed as a function parameter.

const styles = StyleSheet.create((theme) => ({
  // Step indicator
  stepRow: {
    marginBottom: 8,
    flexGrow: 0,
  },
  stepRowContent: {
    gap: 6,
    paddingVertical: 2,
  },
  stepChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceHighest,
    borderWidth: 1,
    borderColor: "transparent",
  },
  stepChipFocused: {
    borderColor: theme.colors.radio.active,
    backgroundColor: theme.colors.surfaceHigh,
  },
  stepChipDone: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.textSecondary,
    opacity: 0.4,
  },
  stepDotFocused: {
    backgroundColor: theme.colors.radio.active,
    opacity: 1,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  stepLabelFocused: {
    color: theme.colors.text,
    fontWeight: "600",
  },

  // Container
  container: {
    gap: 16,
  },
  questionSection: {
    gap: 8,
  },
  headerChip: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 4,
  },
  headerText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
  },
  questionText: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.text,
    marginBottom: 8,
  },

  // Options
  optionsContainer: {
    gap: 4,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.divider,
    gap: 10,
    minHeight: 44,
  },
  optionButtonSelected: {
    backgroundColor: theme.colors.surfaceHigh,
    borderColor: theme.colors.radio.active,
    borderLeftWidth: 3,
  },
  optionButtonDisabled: {
    opacity: 0.6,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioOuterSelected: {
    borderColor: theme.colors.radio.active,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.radio.dot,
  },
  checkboxOuter: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxOuterSelected: {
    borderColor: theme.colors.radio.active,
    backgroundColor: theme.colors.radio.active,
  },
  optionContent: {
    flex: 1,
  },
  optionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.text,
  },
  recommendedTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.radio.active + "20",
  },
  recommendedText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.radio.active,
  },
  optionDescription: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  optionPreview: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 6,
    fontFamily: "monospace",
    backgroundColor: theme.colors.surfaceHighest,
    padding: 6,
    borderRadius: 4,
  },

  // Actions
  actionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  actionsSpacer: {
    flex: 1,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surfaceHighest,
    alignItems: "center",
    justifyContent: "center",
  },
  nextButton: {
    backgroundColor: theme.colors.button.primary.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  nextButtonText: {
    color: theme.colors.button.primary.tint,
    fontSize: 13,
    fontWeight: "600",
  },
  submitButton: {
    backgroundColor: theme.colors.button.primary.background,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonError: {
    backgroundColor: theme.colors.warningCritical,
  },
  submitButtonText: {
    color: theme.colors.button.primary.tint,
    fontSize: 14,
    fontWeight: "600",
  },
  // Secondary "decline to answer" button — sits left of submit for the MCP
  // ask_user variant. Lower visual weight than submit on purpose.
  declineButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: "transparent",
  },
  declineButtonDisabled: {
    opacity: 0.5,
  },
  declineButtonText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },

  // PTY-mode escape hatch (rendered only when submit fails)
  cancelHintContainer: {
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceHighest,
    gap: 8,
  },
  cancelHintText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    lineHeight: 16,
  },
  cancelHintButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    minHeight: 32,
    justifyContent: "center",
  },
  cancelHintButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.text,
  },

  // Other input
  otherInput: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: theme.colors.text,
    minHeight: 60,
    marginTop: 4,
  },

  // Submitted state
  submittedContainer: {
    gap: 6,
  },
  submittedCard: {
    backgroundColor: theme.colors.surfaceHigh,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  submittedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  submittedHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textSecondary,
  },
  submittedQuestion: {
    fontSize: 14,
    color: theme.colors.text,
    paddingLeft: 22,
    marginTop: 2,
  },
  submittedAnswer: {
    paddingLeft: 22,
    marginTop: 4,
    gap: 2,
  },
  submittedValue: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.radio.active,
  },
  submittedDescription: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 1,
  },
}));
