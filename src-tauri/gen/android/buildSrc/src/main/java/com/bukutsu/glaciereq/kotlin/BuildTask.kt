import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val candidates = if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            listOf("npm.cmd", "npm.exe", "npm", "bun", "bun.exe", "bun.cmd", "bun.bat")
        } else {
            listOf("npm", "bun")
        }
        val executable = candidates.firstOrNull { isRunnerAvailable(it) }
            ?: throw GradleException("No supported JavaScript package runner found")
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

    private fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val projectDir = projectDir ?: throw GradleException("projectDir cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val rootDir = File(projectDir, rootDirRel).absoluteFile
        val cargoWrapper = File(
            rootDir,
            if (Os.isFamily(Os.FAMILY_WINDOWS)) "scripts/cargo-locked.cmd" else "scripts/cargo-locked",
        )
        val args = if (executable.startsWith("npm")) {
            listOf("exec", "--", "tauri", "android", "android-studio-script")
        } else {
            listOf("tauri", "android", "android-studio-script")
        }

        execOperations.exec {
            workingDir(rootDir)
            environment("CARGO", cargoWrapper.absolutePath)
            executable(executable)
            args(args)
            if (logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
