
export function formatFloatDisplay(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }

    const strVal = String(value);

    // If it's just ".", return it as is (user typing)
    if (strVal === ".") return ".";
    // If it's "-.", return it as is (user typing)
    if (strVal === "-.") return "-.";

    // Check if it's a valid number
    const parsed = parseFloat(strVal);
    if (isNaN(parsed)) {
        return strVal;
    }

    // If the string representation starts with "." (e.g. ".3")
    if (strVal.startsWith(".")) {
        return "0" + strVal;
    }

    // If it starts with "-." (e.g. "-.3")
    if (strVal.startsWith("-.")) {
        return "-0" + strVal.substring(1);
    }

    return strVal;
}
