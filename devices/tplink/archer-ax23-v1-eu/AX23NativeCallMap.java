// Ghidra 12.2 headless read-only MIPS ELF call-map experiment.
// Emits structural evidence only: symbol names, string *categories*,
// addresses and cross-reference counts. No firmware bytes or pseudocode.
//@category RouterLab.AX23
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.address.Address;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public class AX23NativeCallMap extends GhidraScript {
    private static final String[] TARGETS = new String[] {
        "ubus", "uci", "sysmode", "quick_setup", "wan", "wlan",
        "wireless", "network", "config", "interface"
    };
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_.$@]{0,72}");

    private String matchCategory(String value) {
        if (value == null) return null;
        String lowered = value.toLowerCase(java.util.Locale.ROOT);
        for (String target : TARGETS) {
            if (lowered.contains(target)) return target;
        }
        return null;
    }

    private String safeName(String raw) {
        if (raw == null || !SAFE_NAME.matcher(raw).matches()) return "UNNAMED";
        return raw;
    }

    private int references(Address address, List<String> callers, int max) {
        ReferenceIterator iter = currentProgram.getReferenceManager().getReferencesTo(address);
        int n = 0;
        while (iter.hasNext() && n < 2000) {
            Reference ref = iter.next();
            n++;
            if (callers.size() >= max) continue;
            Function source = currentProgram.getFunctionManager().getFunctionContaining(ref.getFromAddress());
            if (source == null) continue;
            String name = safeName(source.getName());
            if (!callers.contains(name)) callers.add(name);
        }
        Collections.sort(callers);
        return n;
    }

    @Override
    public void run() throws Exception {
        if (currentProgram == null) {
            println("AX23_GHIDRA_ERROR=NO_PROGRAM");
            return;
        }
        String title = safeName(currentProgram.getName());
        println("AX23_GHIDRA_PROGRAM=" + title);
        println("AX23_GHIDRA_FORMAT=" + currentProgram.getExecutableFormat().replaceAll("[^A-Za-z0-9_ ]","_"));
        println("AX23_GHIDRA_LANGUAGE=" + currentProgram.getLanguageID().toString());
        FunctionIterator funcs = currentProgram.getFunctionManager().getFunctions(true);
        int totalFunctions = 0;
        int matchingFunctions = 0;
        while (funcs.hasNext()) {
            monitor.checkCancelled();
            Function f = funcs.next();
            totalFunctions++;
            String family = matchCategory(f.getName());
            if (family == null) continue;
            matchingFunctions++;
            if (matchingFunctions > 50) continue;
            List<String> callers = new ArrayList<>();
            int count = references(f.getEntryPoint(), callers, 5);
            println("AX23_GHIDRA_FUNCTION=" + safeName(f.getName()) +
                " CATEGORY=" + family +
                " LOCATION=" + f.getEntryPoint().toString() +
                " REFS=" + count +
                " CALLERS=" + String.join(",", callers));
        }
        DataIterator it = currentProgram.getListing().getDefinedData(true);
        int considered = 0;
        int matchedStrings = 0;
        while (it.hasNext() && considered < 180000) {
            monitor.checkCancelled();
            Data item = it.next();
            considered++;
            Object value = item.getValue();
            if (!(value instanceof String)) continue;
            String string = (String)value;
            if (string.length() > 200) continue;
            String family = matchCategory(string);
            if (family == null) continue;
            matchedStrings++;
            if (matchedStrings > 60) continue;
            List<String> callers = new ArrayList<>();
            int count = references(item.getAddress(), callers, 5);
            println("AX23_GHIDRA_STRING_XREF=CATEGORY_" + family +
                " ADDRESS=" + item.getAddress().toString() +
                " REFERENCES=" + count +
                " FUNCTIONS=" + String.join(",", callers));
        }
        println("AX23_GHIDRA_SUMMARY=" + title +
            " FUNCTIONS=" + totalFunctions +
            " NAMED_MATCHES=" + matchingFunctions +
            " STRING_CATEGORY_MATCHES=" + matchedStrings +
            " RAW_TEXT_EXPORTED=false");
    }
}
