import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEffect, useState } from "react";
import { UndoRedoProvider, useUndoRedo } from "@/lib/undoRedo";

function Harness() {
  const { registerStateChange, undo, redo, canUndo, canRedo } = useUndoRedo();
  const [value, setValue] = useState("alpha");

  useEffect(() => {
    const next = "bravo";
    registerStateChange("test", value, next, setValue);
    setValue(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div data-testid="value">{value}</div>
      <button onClick={undo} disabled={!canUndo}>undo</button>
      <button onClick={redo} disabled={!canRedo}>redo</button>
    </div>
  );
}

describe("UndoRedoProvider", () => {
  it("undoes and redoes recorded state transitions", () => {
    render(
      <UndoRedoProvider>
        <Harness />
      </UndoRedoProvider>
    );

    const value = screen.getByTestId("value");
    expect(value.textContent).toBe("bravo");

    const undoButton = screen.getByText("undo");
    fireEvent.click(undoButton);
    expect(value.textContent).toBe("alpha");

    const redoButton = screen.getByText("redo");
    fireEvent.click(redoButton);
    expect(value.textContent).toBe("bravo");
  });
});
