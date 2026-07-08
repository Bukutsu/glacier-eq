import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null
    @Input
    var workingDir: String? = null
    @Internal
    var verbosity: String = ""

    @TaskAction
    fun assemble() {
        val executable = """npm""";
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )
                
                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e;
            }
        }
    }

    fun runTauriCli(executable: String) {
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val dir = workingDir ?: throw GradleException("workingDir cannot be null")
        val args = mutableListOf("run", "--", "tauri", "android", "android-studio-script");
        if (verbosity == "debug") {
            args.add("-vv")
        } else if (verbosity == "info") {
            args.add("-v")
        }
        if (release) {
            args.add("--release")
        }
        args.add("--target")
        args.add(target)

        val pb = ProcessBuilder(executable, *args.toTypedArray())
            .directory(File(dir))
            .inheritIO()
        val exitCode = pb.start().waitFor()
        if (exitCode != 0) {
            throw GradleException("\"$executable ${args.joinToString(" ")}\" exited with code $exitCode")
        }
    }
}