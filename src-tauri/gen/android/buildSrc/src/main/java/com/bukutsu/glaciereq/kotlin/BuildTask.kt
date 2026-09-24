import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val candidates = if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            // npm is the locked project entrypoint; Bun is only a fallback for
            // developer machines that do not have Node/npm available.
            listOf("npm.cmd", "npm.exe", "npm", "bun", "bun.exe", "bun.cmd", "bun.bat")
        } else {
            listOf("npm", "bun")
        }
        val executable = candidates.firstOrNull { isRunnerAvailable(it) }
            ?: throw GradleException("No supported JavaScript package runner found")
        // A present runner's nonzero build exit is a real build failure. Only
        // fall back when the executable itself cannot be found.
        runTauriCli(executable)
    }

    private fun isRunnerAvailable(executable: String): Boolean {
        val direct = File(executable)
        if (direct.isFile && direct.canExecute()) return true
        val path = System.getenv("PATH") ?: return false
        return path.split(File.pathSeparator).any { entry ->
            val candidate = File(entry, executable)
            candidate.isFile && candidate.canExecute()
        }
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = if (executable.startsWith("npm")) {
            listOf("exec", "--", "tauri", "android", "android-studio-script")
        } else {
            listOf("tauri", "android", "android-studio-script")
        };

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}