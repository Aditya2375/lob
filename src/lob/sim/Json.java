package lob.sim;

import java.util.List;

/** Minimal JSON emitter for scenario files: numbers, strings, arrays, objects. */
final class Json {
    private Json() {}

    static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                default -> sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    static String longs(long[] a) {
        StringBuilder sb = new StringBuilder(a.length * 7);
        sb.append('[');
        for (int i = 0; i < a.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(a[i]);
        }
        return sb.append(']').toString();
    }

    static String depthRows(List<long[]> rows) {
        // NB: new StringBuilder('[') would be the int-capacity overload, not content.
        StringBuilder sb = new StringBuilder().append('[');
        for (int i = 0; i < rows.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('[').append(rows.get(i)[0]).append(',').append(rows.get(i)[1]).append(']');
        }
        return sb.append(']').toString();
    }
}
